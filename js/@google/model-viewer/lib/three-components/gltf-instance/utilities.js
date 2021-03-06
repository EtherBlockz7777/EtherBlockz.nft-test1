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
const $callbacks = Symbol('callbacks');
const $visitMesh = Symbol('visitMesh');
const $visitElement = Symbol('visitElement');
const $visitNode = Symbol('visitNode');
const $visitScene = Symbol('visitScene');
const $visitMaterial = Symbol('visitMaterial');
/**
 * GLTFTreeVisitor implements a deterministic traversal order of a valid,
 * deserialized glTF 2.0 model. It supports selective element visitation via
 * callbacks configured based on element type. For example, to visit all
 * materials in all scenes in a glTF:
 *
 * ```javascript
 * const visitor = new GLTFTreeVisitor({
 *   material: (material, index, hierarchy) => {
 *     // material is a glTF 2.0 Material
 *     // index is the index of material in gltf.materials
 *     // hierarchy includes ancestors of material in the glTF
 *   }
 * });
 *
 * visitor.visit(someInMemoryGLTF, { allScenes: true });
 * ```
 *
 * The traversal order of the visitor is pre-order, depth-first.
 *
 * Note that the traversal order is not guaranteed to correspond to the
 * index of a given element in any way. Rather, traversal order is based
 * on the hierarchical order of the scene graph.
 */
export class GLTFTreeVisitor {
    constructor(callbacks) {
        this[$callbacks] = callbacks;
    }
    /**
     * Visit a given in-memory glTF via the configured callbacks of this visitor.
     * Optionally, all scenes may be visited (as opposed to just the active one).
     * Sparse traversal can also be specified, in which case elements that
     * re-appear multiple times in the scene graph will only be visited once.
     */
    visit(gltf, options = {}) {
        const allScenes = !!options.allScenes;
        const sparse = !!options.sparse;
        const scenes = allScenes ?
            gltf.scenes || [] :
            (gltf.scenes && gltf.scene != null) ? [gltf.scenes[gltf.scene]] : [];
        const state = { hierarchy: [], visited: new Set(), sparse, gltf };
        for (const scene of scenes) {
            this[$visitScene](gltf.scenes.indexOf(scene), state);
        }
    }
    [$visitElement](index, elementList, state, visit, traverse) {
        if (elementList == null) {
            return;
        }
        const element = elementList[index];
        const { sparse, hierarchy, visited } = state;
        if (element == null) {
            return;
        }
        if (sparse && visited.has(element)) {
            return;
        }
        visited.add(element);
        hierarchy.push(element);
        if (visit != null) {
            visit(element, index, hierarchy);
        }
        if (traverse != null) {
            traverse(element);
        }
        hierarchy.pop();
    }
    [$visitScene](index, state) {
        const { gltf } = state;
        const { scene: visit } = this[$callbacks];
        this[$visitElement](index, gltf.scenes, state, visit, (scene) => {
            // A scene is not required to have a list of nodes
            if (scene.nodes == null) {
                return;
            }
            for (const nodeIndex of scene.nodes) {
                this[$visitNode](nodeIndex, state);
            }
        });
    }
    [$visitNode](index, state) {
        const { gltf } = state;
        const { node: visit } = this[$callbacks];
        this[$visitElement](index, gltf.nodes, state, visit, (node) => {
            if (node.mesh != null) {
                this[$visitMesh](node.mesh, state);
            }
            if (node.children != null) {
                for (const childNodeIndex of node.children) {
                    this[$visitNode](childNodeIndex, state);
                }
            }
        });
    }
    [$visitMesh](index, state) {
        const { gltf } = state;
        const { mesh: visit } = this[$callbacks];
        this[$visitElement](index, gltf.meshes, state, visit, (mesh) => {
            for (const primitive of mesh.primitives) {
                if (primitive.material != null) {
                    this[$visitMaterial](primitive.material, state);
                }
            }
        });
    }
    [$visitMaterial](index, state) {
        const { gltf } = state;
        const { material: visit } = this[$callbacks];
        this[$visitElement](index, gltf.materials, state, visit);
    }
}
//# sourceMappingURL=utilities.js.map