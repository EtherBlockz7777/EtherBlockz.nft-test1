/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { AnimationMixer, Box3, LoopPingPong, LoopRepeat, Matrix3, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { $renderer } from '../model-viewer-base.js';
import { resolveDpr } from '../utilities.js';
import { Damper, SETTLING_TIME } from './Damper.js';
import { Hotspot } from './Hotspot.js';
import { reduceVertices } from './ModelUtils.js';
import { Shadow } from './Shadow.js';
export const IlluminationRole = {
    Primary: 'primary',
    Secondary: 'secondary'
};
export const DEFAULT_FOV_DEG = 45;
const view = new Vector3();
const target = new Vector3();
const normalWorld = new Vector3();
const raycaster = new Raycaster();
const vector3 = new Vector3();
const ndc = new Vector2();
/**
 * A THREE.Scene object that takes a Model and CanvasHTMLElement and
 * constructs a framed scene based off of the canvas dimensions.
 * Provides lights and cameras to be used in a renderer.
 */
export class ModelScene extends Scene {
    constructor({ canvas, element, width, height }) {
        super();
        this.context = null;
        this.annotationRenderer = new CSS2DRenderer();
        this.schemaElement = document.createElement('script');
        this.width = 1;
        this.height = 1;
        this.aspect = 1;
        this.renderCount = 0;
        this.externalRenderer = null;
        // These default camera values are never used, as they are reset once the
        // model is loaded and framing is computed.
        this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
        this.xrCamera = null;
        this.url = null;
        this.target = new Object3D();
        this.modelContainer = new Object3D();
        this.animationNames = [];
        this.boundingBox = new Box3();
        this.size = new Vector3();
        this.idealAspect = 0;
        this.framedFoVDeg = DEFAULT_FOV_DEG;
        this.boundingRadius = 0;
        this.shadow = null;
        this.shadowIntensity = 0;
        this.shadowSoftness = 1;
        this.exposure = 1;
        this.canScale = true;
        this.tightBounds = false;
        this.isDirty = false;
        this.goalTarget = new Vector3();
        this.targetDamperX = new Damper();
        this.targetDamperY = new Damper();
        this.targetDamperZ = new Damper();
        this._currentGLTF = null;
        this.cancelPendingSourceChange = null;
        this.animationsByName = new Map();
        this.currentAnimationAction = null;
        this.name = 'ModelScene';
        this.element = element;
        this.canvas = canvas;
        // These default camera values are never used, as they are reset once the
        // model is loaded and framing is computed.
        this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
        this.camera.name = 'MainCamera';
        this.add(this.target);
        this.setSize(width, height);
        this.target.name = 'Target';
        this.modelContainer.name = 'ModelContainer';
        this.target.add(this.modelContainer);
        this.mixer = new AnimationMixer(this.modelContainer);
        const { domElement } = this.annotationRenderer;
        const { style } = domElement;
        style.display = 'none';
        style.pointerEvents = 'none';
        style.position = 'absolute';
        style.top = '0';
        this.element.shadowRoot.querySelector('.default').appendChild(domElement);
        this.schemaElement.setAttribute('type', 'application/ld+json');
    }
    /**
     * Function to create the context lazily, as when there is only one
     * <model-viewer> element, the renderer's 3D context can be displayed
     * directly. This extra context is necessary to copy the renderings into when
     * there are more than one.
     */
    createContext() {
        this.context = this.canvas.getContext('2d');
    }
    getCamera() {
        return this.xrCamera != null ? this.xrCamera : this.camera;
    }
    queueRender() {
        this.isDirty = true;
    }
    shouldRender() {
        return this.isDirty;
    }
    hasRendered() {
        this.isDirty = false;
    }
    /**
     * Pass in a THREE.Object3D to be controlled
     * by this model.
     */
    async setObject(model) {
        this.reset();
        this.modelContainer.add(model);
        await this.setupScene();
    }
    /**
     * Sets the model via URL.
     */
    async setSource(url, progressCallback = () => { }) {
        if (!url || url === this.url) {
            progressCallback(1);
            return;
        }
        this.reset();
        this.url = url;
        if (this.externalRenderer != null) {
            const framingInfo = await this.externalRenderer.load(progressCallback);
            this.boundingRadius = framingInfo.framedRadius;
            this.idealAspect = framingInfo.fieldOfViewAspect;
            this.dispatchEvent({ type: 'model-load', url: this.url });
            return;
        }
        // If we have pending work due to a previous source change in progress,
        // cancel it so that we do not incur a race condition:
        if (this.cancelPendingSourceChange != null) {
            this.cancelPendingSourceChange();
            this.cancelPendingSourceChange = null;
        }
        let gltf;
        try {
            gltf = await new Promise(async (resolve, reject) => {
                this.cancelPendingSourceChange = () => reject();
                try {
                    const result = await this.element[$renderer].loader.load(url, this.element, progressCallback);
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            });
        }
        catch (error) {
            if (error == null) {
                // Loading was cancelled, so silently return
                return;
            }
            throw error;
        }
        this.reset();
        this.url = url;
        this._currentGLTF = gltf;
        if (gltf != null) {
            this.modelContainer.add(gltf.scene);
        }
        const { animations } = gltf;
        const animationsByName = new Map();
        const animationNames = [];
        for (const animation of animations) {
            animationsByName.set(animation.name, animation);
            animationNames.push(animation.name);
        }
        this.animations = animations;
        this.animationsByName = animationsByName;
        this.animationNames = animationNames;
        await this.setupScene();
    }
    async setupScene() {
        this.updateBoundingBox();
        await this.updateFraming();
        this.updateShadow();
        this.setShadowIntensity(this.shadowIntensity);
        this.dispatchEvent({ type: 'model-load', url: this.url });
    }
    reset() {
        this.url = null;
        this.queueRender();
        if (this.shadow != null) {
            this.shadow.setIntensity(0);
        }
        const gltf = this._currentGLTF;
        // Remove all current children
        if (gltf != null) {
            for (const child of this.modelContainer.children) {
                this.modelContainer.remove(child);
            }
            gltf.dispose();
            this._currentGLTF = null;
        }
        if (this.currentAnimationAction != null) {
            this.currentAnimationAction.stop();
            this.currentAnimationAction = null;
        }
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this);
    }
    get currentGLTF() {
        return this._currentGLTF;
    }
    /**
     * Updates the ModelScene for a new container size in CSS pixels.
     */
    setSize(width, height) {
        if (this.width === width && this.height === height) {
            return;
        }
        this.width = Math.max(width, 1);
        this.height = Math.max(height, 1);
        this.annotationRenderer.setSize(width, height);
        this.aspect = this.width / this.height;
        if (this.externalRenderer != null) {
            const dpr = resolveDpr();
            this.externalRenderer.resize(width * dpr, height * dpr);
        }
        this.queueRender();
    }
    updateBoundingBox() {
        this.target.remove(this.modelContainer);
        if (this.tightBounds === true) {
            const bound = (box, vertex) => {
                return box.expandByPoint(vertex);
            };
            this.boundingBox = reduceVertices(this.modelContainer, bound, new Box3());
        }
        else {
            this.boundingBox.setFromObject(this.modelContainer);
        }
        this.boundingBox.getSize(this.size);
        this.target.add(this.modelContainer);
    }
    /**
     * Calculates the boundingRadius and idealAspect that allows the 3D
     * object to be framed tightly in a 2D window of any aspect ratio without
     * clipping at any camera orbit. The camera's center target point can be
     * optionally specified. If no center is specified, it defaults to the center
     * of the bounding box, which means asymmetric models will tend to be tight on
     * one side instead of both. Proper choice of center can correct this.
     */
    async updateFraming() {
        this.target.remove(this.modelContainer);
        let center = this.boundingBox.getCenter(new Vector3());
        if (this.tightBounds === true) {
            await this.element.requestUpdate('cameraTarget');
            center = this.getTarget();
        }
        const radiusSquared = (value, vertex) => {
            return Math.max(value, center.distanceToSquared(vertex));
        };
        this.boundingRadius =
            Math.sqrt(reduceVertices(this.modelContainer, radiusSquared, 0));
        const horizontalTanFov = (value, vertex) => {
            vertex.sub(center);
            const radiusXZ = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
            return Math.max(value, radiusXZ / (this.idealCameraDistance() - Math.abs(vertex.y)));
        };
        this.idealAspect =
            reduceVertices(this.modelContainer, horizontalTanFov, 0) /
                Math.tan((this.framedFoVDeg / 2) * Math.PI / 180);
        this.target.add(this.modelContainer);
    }
    idealCameraDistance() {
        const halfFovRad = (this.framedFoVDeg / 2) * Math.PI / 180;
        return this.boundingRadius / Math.sin(halfFovRad);
    }
    /**
     * Set's the framedFieldOfView based on the aspect ratio of the window in
     * order to keep the model fully visible at any camera orientation.
     */
    adjustedFoV(fovDeg) {
        const vertical = Math.tan((fovDeg / 2) * Math.PI / 180) *
            Math.max(1, this.idealAspect / this.aspect);
        return 2 * Math.atan(vertical) * 180 / Math.PI;
    }
    getNDC(clientX, clientY) {
        if (this.xrCamera != null) {
            ndc.set(clientX / window.screen.width, clientY / window.screen.height);
        }
        else {
            const rect = this.element.getBoundingClientRect();
            ndc.set((clientX - rect.x) / this.width, (clientY - rect.y) / this.height);
        }
        ndc.multiplyScalar(2).subScalar(1);
        ndc.y *= -1;
        return ndc;
    }
    /**
     * Returns the size of the corresponding canvas element.
     */
    getSize() {
        return { width: this.width, height: this.height };
    }
    /**
     * Sets the point in model coordinates the model should orbit/pivot around.
     */
    setTarget(modelX, modelY, modelZ) {
        this.goalTarget.set(-modelX, -modelY, -modelZ);
    }
    /**
     * Set the decay time of, affects the speed of target transitions.
     */
    setTargetDamperDecayTime(decayMilliseconds) {
        this.targetDamperX.setDecayTime(decayMilliseconds);
        this.targetDamperY.setDecayTime(decayMilliseconds);
        this.targetDamperZ.setDecayTime(decayMilliseconds);
    }
    /**
     * Gets the point in model coordinates the model should orbit/pivot around.
     */
    getTarget() {
        return vector3.copy(this.goalTarget).multiplyScalar(-1);
    }
    /**
     * Shifts the model to the target point immediately instead of easing in.
     */
    jumpToGoal() {
        this.updateTarget(SETTLING_TIME);
    }
    /**
     * This should be called every frame with the frame delta to cause the target
     * to transition to its set point.
     */
    updateTarget(delta) {
        const goal = this.goalTarget;
        const target = this.target.position;
        if (!goal.equals(target)) {
            const normalization = this.boundingRadius / 10;
            let { x, y, z } = target;
            x = this.targetDamperX.update(x, goal.x, delta, normalization);
            y = this.targetDamperY.update(y, goal.y, delta, normalization);
            z = this.targetDamperZ.update(z, goal.z, delta, normalization);
            this.target.position.set(x, y, z);
            this.target.updateMatrixWorld();
            this.setShadowRotation(this.yaw);
            this.queueRender();
        }
    }
    /**
     * Yaw the +z (front) of the model toward the indicated world coordinates.
     */
    pointTowards(worldX, worldZ) {
        const { x, z } = this.position;
        this.yaw = Math.atan2(worldX - x, worldZ - z);
    }
    /**
     * Yaw is the scene's orientation about the y-axis, around the rotation
     * center.
     */
    set yaw(radiansY) {
        this.rotation.y = radiansY;
        this.updateMatrixWorld(true);
        this.setShadowRotation(radiansY);
        this.queueRender();
    }
    get yaw() {
        return this.rotation.y;
    }
    set animationTime(value) {
        this.mixer.setTime(value);
    }
    get animationTime() {
        if (this.currentAnimationAction != null) {
            const loopCount = Math.max(this.currentAnimationAction._loopCount, 0);
            if (this.currentAnimationAction.loop === LoopPingPong &&
                (loopCount & 1) === 1) {
                return this.duration - this.currentAnimationAction.time;
            }
            else {
                return this.currentAnimationAction.time;
            }
        }
        return 0;
    }
    get duration() {
        if (this.currentAnimationAction != null &&
            this.currentAnimationAction.getClip()) {
            return this.currentAnimationAction.getClip().duration;
        }
        return 0;
    }
    get hasActiveAnimation() {
        return this.currentAnimationAction != null;
    }
    /**
     * Plays an animation if there are any associated with the current model.
     * Accepts an optional string name of an animation to play. If no name is
     * provided, or if no animation is found by the given name, always falls back
     * to playing the first animation.
     */
    playAnimation(name = null, crossfadeTime = 0, loopMode = LoopRepeat, repetitionCount = Infinity) {
        if (this._currentGLTF == null) {
            return;
        }
        const { animations } = this;
        if (animations == null || animations.length === 0) {
            console.warn(`Cannot play animation (model does not have any animations)`);
            return;
        }
        let animationClip = null;
        if (name != null) {
            animationClip = this.animationsByName.get(name);
        }
        if (animationClip == null) {
            animationClip = animations[0];
        }
        try {
            const { currentAnimationAction: lastAnimationAction } = this;
            const action = this.mixer.clipAction(animationClip, this);
            this.currentAnimationAction = action;
            if (this.element.paused) {
                this.mixer.stopAllAction();
            }
            else if (lastAnimationAction != null && action !== lastAnimationAction) {
                action.crossFadeFrom(lastAnimationAction, crossfadeTime, false);
            }
            action.setLoop(loopMode, repetitionCount);
            action.enabled = true;
            action.play();
        }
        catch (error) {
            console.error(error);
        }
    }
    stopAnimation() {
        this.currentAnimationAction = null;
        this.mixer.stopAllAction();
    }
    updateAnimation(step) {
        this.mixer.update(step);
    }
    subscribeMixerEvent(event, callback) {
        this.mixer.addEventListener(event, callback);
    }
    /**
     * Call if the object has been changed in such a way that the shadow's shape
     * has changed (not a rotation about the Y axis).
     */
    updateShadow() {
        const shadow = this.shadow;
        if (shadow != null) {
            const side = this.element.arPlacement === 'wall' ? 'back' : 'bottom';
            shadow.setScene(this, this.shadowSoftness, side);
            shadow.setRotation(this.yaw);
        }
    }
    /**
     * Sets the shadow's intensity, lazily creating the shadow as necessary.
     */
    setShadowIntensity(shadowIntensity) {
        this.shadowIntensity = shadowIntensity;
        if (this._currentGLTF == null) {
            return;
        }
        if (shadowIntensity <= 0 && this.shadow == null) {
            return;
        }
        if (this.shadow == null) {
            const side = this.element.arPlacement === 'wall' ? 'back' : 'bottom';
            this.shadow = new Shadow(this, this.shadowSoftness, side);
            this.shadow.setRotation(this.yaw);
        }
        this.shadow.setIntensity(shadowIntensity);
    }
    /**
     * Sets the shadow's softness by mapping a [0, 1] softness parameter to the
     * shadow's resolution. This involves reallocation, so it should not be
     * changed frequently. Softer shadows are cheaper to render.
     */
    setShadowSoftness(softness) {
        this.shadowSoftness = softness;
        const shadow = this.shadow;
        if (shadow != null) {
            shadow.setSoftness(softness);
        }
    }
    /**
     * The shadow must be rotated manually to match any global rotation applied to
     * this model. The input is the global orientation about the Y axis.
     */
    setShadowRotation(radiansY) {
        const shadow = this.shadow;
        if (shadow != null) {
            shadow.setRotation(radiansY);
        }
    }
    /**
     * Call to check if the shadow needs an updated render; returns true if an
     * update is needed and resets the state.
     */
    isShadowDirty() {
        const shadow = this.shadow;
        if (shadow == null) {
            return false;
        }
        else {
            const { needsUpdate } = shadow;
            shadow.needsUpdate = false;
            return needsUpdate;
        }
    }
    /**
     * Shift the floor vertically from the bottom of the model's bounding box by
     * offset (should generally be negative).
     */
    setShadowScaleAndOffset(scale, offset) {
        const shadow = this.shadow;
        if (shadow != null) {
            shadow.setScaleAndOffset(scale, offset);
        }
    }
    get raycaster() {
        return raycaster;
    }
    /**
     * This method returns the world position, model-space normal and texture
     * coordinate of the point on the mesh corresponding to the input pixel
     * coordinates given relative to the model-viewer element. If the mesh
     * is not hit, the result is null.
     */
    positionAndNormalFromPoint(ndcPosition, object = this) {
        this.raycaster.setFromCamera(ndcPosition, this.getCamera());
        const hits = this.raycaster.intersectObject(object, true);
        if (hits.length === 0) {
            return null;
        }
        const hit = hits[0];
        if (hit.face == null) {
            return null;
        }
        if (hit.uv == null) {
            return { position: hit.point, normal: hit.face.normal, uv: null };
        }
        hit.face.normal.applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld));
        return { position: hit.point, normal: hit.face.normal, uv: hit.uv };
    }
    /**
     * The following methods are for operating on the set of Hotspot objects
     * attached to the scene. These come from DOM elements, provided to slots by
     * the Annotation Mixin.
     */
    addHotspot(hotspot) {
        this.target.add(hotspot);
        // This happens automatically in render(), but we do it early so that
        // the slots appear in the shadow DOM and the elements get attached,
        // allowing us to dispatch events on them.
        this.annotationRenderer.domElement.appendChild(hotspot.element);
    }
    removeHotspot(hotspot) {
        this.target.remove(hotspot);
    }
    /**
     * Helper method to apply a function to all hotspots.
     */
    forHotspots(func) {
        const { children } = this.target;
        for (let i = 0, l = children.length; i < l; i++) {
            const hotspot = children[i];
            if (hotspot instanceof Hotspot) {
                func(hotspot);
            }
        }
    }
    /**
     * Update the CSS visibility of the hotspots based on whether their normals
     * point toward the camera.
     */
    updateHotspots(viewerPosition) {
        this.forHotspots((hotspot) => {
            view.copy(viewerPosition);
            target.setFromMatrixPosition(hotspot.matrixWorld);
            view.sub(target);
            normalWorld.copy(hotspot.normal)
                .transformDirection(this.target.matrixWorld);
            if (view.dot(normalWorld) < 0) {
                hotspot.hide();
            }
            else {
                hotspot.show();
            }
        });
    }
    /**
     * Rotate all hotspots to an absolute orientation given by the input number of
     * radians. Zero returns them to upright.
     */
    orientHotspots(radians) {
        this.forHotspots((hotspot) => {
            hotspot.orient(radians);
        });
    }
    /**
     * Set the rendering visibility of all hotspots. This is used to hide them
     * during transitions and such.
     */
    setHotspotsVisibility(visible) {
        this.forHotspots((hotspot) => {
            hotspot.visible = visible;
        });
    }
    updateSchema(src) {
        var _a;
        const { schemaElement, element } = this;
        const { alt, poster, iosSrc } = element;
        if (src != null) {
            const encoding = [{
                    '@type': 'MediaObject',
                    contentUrl: src,
                    encodingFormat: ((_a = src.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === 'gltf' ?
                        'model/gltf+json' :
                        'model/gltf-binary'
                }];
            if (iosSrc) {
                encoding.push({
                    '@type': 'MediaObject',
                    contentUrl: iosSrc,
                    encodingFormat: 'model/vnd.usdz+zip'
                });
            }
            const structuredData = {
                '@context': 'http://schema.org/',
                '@type': '3DModel',
                image: poster !== null && poster !== void 0 ? poster : undefined,
                name: alt !== null && alt !== void 0 ? alt : undefined,
                encoding
            };
            schemaElement.textContent = JSON.stringify(structuredData);
            document.head.appendChild(schemaElement);
        }
        else if (schemaElement.parentElement != null) {
            schemaElement.parentElement.removeChild(schemaElement);
        }
    }
}
//# sourceMappingURL=ModelScene.js.map