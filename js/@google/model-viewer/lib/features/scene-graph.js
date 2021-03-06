/* @license
 * Copyright 2020 Google LLC. All Rights Reserved.
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { property } from 'lit-element';
import { Euler, RepeatWrapping, RGBFormat, sRGBEncoding, TextureLoader } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { $needsRender, $onModelLoad, $renderer, $scene } from '../model-viewer-base.js';
import { normalizeUnit } from '../styles/conversions.js';
import { parseExpressions } from '../styles/parsers.js';
import GLTFExporterMaterialsVariantsExtension from '../three-components/gltf-instance/VariantMaterialExporterPlugin';
import { $availableVariants, $materialFromPoint, $prepareVariantsForExport, $switchVariant, Model } from './scene-graph/model.js';
import { Texture as ModelViewerTexture } from './scene-graph/texture';
export const $currentGLTF = Symbol('currentGLTF');
const $model = Symbol('model');
const $getOnUpdateMethod = Symbol('getOnUpdateMethod');
const $textureLoader = Symbol('textureLoader');
const $originalGltfJson = Symbol('originalGltfJson');
/**
 * SceneGraphMixin manages exposes a model API in order to support operations on
 * the <model-viewer> scene graph.
 */
export const SceneGraphMixin = (ModelViewerElement) => {
    var _a, _b, _c, _d;
    class SceneGraphModelViewerElement extends ModelViewerElement {
        constructor() {
            super(...arguments);
            this[_a] = undefined;
            this[_b] = null;
            this[_c] = new TextureLoader();
            this[_d] = null;
            this.variantName = null;
            this.orientation = '0 0 0';
            this.scale = '1 1 1';
        }
        // Scene-graph API:
        /** @export */
        get model() {
            return this[$model];
        }
        get availableVariants() {
            return this.model ? this.model[$availableVariants]() : [];
        }
        /**
         * Returns a deep copy of the gltf JSON as loaded. It will not reflect
         * changes to the scene-graph, nor will editing it have any effect.
         */
        get originalGltfJson() {
            return this[$originalGltfJson];
        }
        [(_a = $model, _b = $currentGLTF, _c = $textureLoader, _d = $originalGltfJson, $getOnUpdateMethod)]() {
            return () => {
                this[$needsRender]();
            };
        }
        async createTexture(uri, type = 'image/png') {
            const currentGLTF = this[$currentGLTF];
            const texture = await new Promise((resolve) => this[$textureLoader].load(uri, resolve));
            if (!currentGLTF || !texture) {
                return null;
            }
            // Applies default settings.
            texture.encoding = sRGBEncoding;
            texture.wrapS = RepeatWrapping;
            texture.wrapT = RepeatWrapping;
            texture.flipY = false;
            // This hack is because GLTFExporter checks if format is RGB vs RGBA to
            // decide if it should save as JPEG vs PNG. However, TextureLoader sets
            // format based on if the url ends in .jpg, which does not work for an
            // ObjectURL like we're passing here. So, to keep from inflating all JPEGs
            // to PNGs, we allow the user of the API to specify the type.
            if (type === 'image/jpeg') {
                texture.format = RGBFormat;
            }
            return new ModelViewerTexture(this[$getOnUpdateMethod](), texture);
        }
        async updated(changedProperties) {
            super.updated(changedProperties);
            if (changedProperties.has('variantName')) {
                const threeGLTF = this[$currentGLTF];
                const { variantName } = this;
                if (threeGLTF != null) {
                    await this[$model][$switchVariant](variantName);
                    this[$needsRender]();
                    this.dispatchEvent(new CustomEvent('variant-applied'));
                }
            }
            if (changedProperties.has('orientation') ||
                changedProperties.has('scale')) {
                const { modelContainer } = this[$scene];
                const orientation = parseExpressions(this.orientation)[0]
                    .terms;
                const roll = normalizeUnit(orientation[0]).number;
                const pitch = normalizeUnit(orientation[1]).number;
                const yaw = normalizeUnit(orientation[2]).number;
                modelContainer.quaternion.setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
                const scale = parseExpressions(this.scale)[0]
                    .terms;
                modelContainer.scale.set(scale[0].number, scale[1].number, scale[2].number);
                this[$scene].updateBoundingBox();
                this[$scene].updateShadow();
                this[$renderer].arRenderer.onUpdateScene();
                this[$needsRender]();
            }
        }
        [$onModelLoad]() {
            super[$onModelLoad]();
            const { currentGLTF } = this[$scene];
            if (currentGLTF != null) {
                const { correlatedSceneGraph } = currentGLTF;
                if (correlatedSceneGraph != null &&
                    currentGLTF !== this[$currentGLTF]) {
                    this[$model] =
                        new Model(correlatedSceneGraph, this[$getOnUpdateMethod]());
                    this[$originalGltfJson] =
                        JSON.parse(JSON.stringify(correlatedSceneGraph.gltf));
                }
                // KHR_materials_variants extension spec:
                // https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_variants
                if ('variants' in currentGLTF.userData) {
                    this.requestUpdate('variantName');
                }
            }
            this[$currentGLTF] = currentGLTF;
            // TODO: remove this event, as it is synonymous with the load event.
            this.dispatchEvent(new CustomEvent('scene-graph-ready'));
        }
        /** @export */
        async exportScene(options) {
            const scene = this[$scene];
            return new Promise(async (resolve) => {
                // Defaults
                const opts = {
                    binary: true,
                    onlyVisible: true,
                    maxTextureSize: Infinity,
                    forcePowerOfTwoTextures: false,
                    includeCustomExtensions: false,
                    embedImages: true
                };
                Object.assign(opts, options);
                // Not configurable
                opts.animations = scene.animations;
                opts.truncateDrawRange = true;
                const shadow = scene.shadow;
                let visible = false;
                // Remove shadow from export
                if (shadow != null) {
                    visible = shadow.visible;
                    shadow.visible = false;
                }
                await this[$model][$prepareVariantsForExport]();
                const exporter = new GLTFExporter()
                    .register((writer) => new GLTFExporterMaterialsVariantsExtension(writer));
                exporter.parse(scene.modelContainer.children[0], (gltf) => {
                    return resolve(new Blob([opts.binary ? gltf : JSON.stringify(gltf)], {
                        type: opts.binary ? 'application/octet-stream' :
                            'application/json'
                    }));
                }, opts);
                if (shadow != null) {
                    shadow.visible = visible;
                }
            });
        }
        materialFromPoint(pixelX, pixelY) {
            const scene = this[$scene];
            const ndcCoords = scene.getNDC(pixelX, pixelY);
            scene.raycaster.setFromCamera(ndcCoords, scene.getCamera());
            return this[$model][$materialFromPoint](scene.raycaster);
        }
    }
    __decorate([
        property({ type: String, attribute: 'variant-name' })
    ], SceneGraphModelViewerElement.prototype, "variantName", void 0);
    __decorate([
        property({ type: String, attribute: 'orientation' })
    ], SceneGraphModelViewerElement.prototype, "orientation", void 0);
    __decorate([
        property({ type: String, attribute: 'scale' })
    ], SceneGraphModelViewerElement.prototype, "scale", void 0);
    return SceneGraphModelViewerElement;
};
//# sourceMappingURL=scene-graph.js.map