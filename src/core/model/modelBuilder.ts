/**
 * Model Builder – fluent API for constructing a StructuralModel
 * ═══════════════════════════════════════════════════════════════
 */

import type {
  StructuralModel, StructuralNode, StructuralElement,
  Material, Section, LoadCase, LoadCombination,
  Restraints, NodalLoad, SlabProperties,
} from './types';
import { FREE_RESTRAINTS } from './types';

export class ModelBuilder {
  private model: StructuralModel = {
    nodes: [],
    elements: [],
    materials: [],
    sections: [],
    loadCases: [],
    combinations: [],
  };

  addNode(
    id: number, x: number, y: number, z: number,
    restraints: Restraints = FREE_RESTRAINTS,
    nodalLoads: NodalLoad[] = [],
    label?: string,
  ): this {
    this.model.nodes.push({ id, x, y, z, restraints, nodalLoads, label });
    return this;
  }

  addElement(elem: StructuralElement): this {
    this.model.elements.push(elem);
    return this;
  }

  addMaterial(mat: Material): this {
    this.model.materials.push(mat);
    return this;
  }

  addSection(sec: Section): this {
    this.model.sections.push(sec);
    return this;
  }

  addLoadCase(lc: LoadCase): this {
    this.model.loadCases.push(lc);
    return this;
  }

  addCombination(combo: LoadCombination): this {
    this.model.combinations.push(combo);
    return this;
  }

  build(): StructuralModel {
    return { ...this.model };
  }
}
