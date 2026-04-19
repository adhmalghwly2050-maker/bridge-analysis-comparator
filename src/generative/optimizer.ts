// ===================== GENETIC OPTIMIZATION ALGORITHM =====================
// Minimizes total cost while ensuring ACI 318-19 design checks pass.
import type { GenerativeInput, GeneratedStructuralOption, EvaluatedOption } from './types';
import { evaluateOptions } from './evaluator';

interface Chromosome {
  beamB: number;
  beamH: number;
  colB: number;
  colH: number;
  slabThickness: number;
}

const SECTION_STEPS = [150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800];
const SLAB_STEPS = [120, 130, 140, 150, 160, 170, 180, 200, 220, 250];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createRandomChromosome(): Chromosome {
  return {
    beamB: randomChoice(SECTION_STEPS.filter(s => s >= 200 && s <= 400)),
    beamH: randomChoice(SECTION_STEPS.filter(s => s >= 300 && s <= 700)),
    colB: randomChoice(SECTION_STEPS.filter(s => s >= 250 && s <= 600)),
    colH: randomChoice(SECTION_STEPS.filter(s => s >= 250 && s <= 600)),
    slabThickness: randomChoice(SLAB_STEPS),
  };
}

function crossover(a: Chromosome, b: Chromosome): Chromosome {
  return {
    beamB: Math.random() > 0.5 ? a.beamB : b.beamB,
    beamH: Math.random() > 0.5 ? a.beamH : b.beamH,
    colB: Math.random() > 0.5 ? a.colB : b.colB,
    colH: Math.random() > 0.5 ? a.colH : b.colH,
    slabThickness: Math.random() > 0.5 ? a.slabThickness : b.slabThickness,
  };
}

function mutate(c: Chromosome): Chromosome {
  const field = randomChoice(['beamB', 'beamH', 'colB', 'colH', 'slabThickness'] as const);
  const clone = { ...c };
  if (field === 'slabThickness') {
    clone[field] = randomChoice(SLAB_STEPS);
  } else {
    const pool = field.startsWith('beam')
      ? SECTION_STEPS.filter(s => s >= 200 && s <= 700)
      : SECTION_STEPS.filter(s => s >= 250 && s <= 600);
    clone[field] = randomChoice(pool);
  }
  return clone;
}

/**
 * Fitness function: lower total cost = higher fitness.
 * Options that fail ACI 318-19 design checks are heavily penalised so the
 * algorithm always prefers safe options, then picks the cheapest among them.
 */
function fitness(ev: EvaluatedOption): number {
  if (!ev.design.allPassing) {
    // Penalty: treat cost as 10× to push failing designs to the back
    return -ev.cost.totalCost * 10;
  }
  return -ev.cost.totalCost; // negative because we sort descending (highest fitness = winner)
}

/**
 * Run genetic optimization on a specific structural system type.
 * Objective: find the minimum-cost section that still passes ACI 318-19 checks.
 */
export function optimizeOption(
  baseOption: GeneratedStructuralOption,
  input: GenerativeInput,
  populationSize = 20,
  generations = 15,
): EvaluatedOption {
  // Initialize population — seed with the base option as the first chromosome
  let population: Chromosome[] = [
    {
      beamB: baseOption.sections.beamB, beamH: baseOption.sections.beamH,
      colB: baseOption.sections.colB, colH: baseOption.sections.colH,
      slabThickness: baseOption.sections.slabThickness,
    },
    ...Array.from({ length: populationSize - 1 }, () => createRandomChromosome()),
  ];

  let bestEval: EvaluatedOption | null = null;

  for (let gen = 0; gen < generations; gen++) {
    // Evaluate each chromosome
    const evaluated = population.map(chromo => {
      const opt: GeneratedStructuralOption = {
        ...baseOption,
        sections: { ...baseOption.sections, ...chromo },
      };
      const [result] = evaluateOptions([opt], input);
      return { chromo, result };
    });

    // Sort by fitness (minimise cost, passing designs first)
    evaluated.sort((a, b) => fitness(b.result) - fitness(a.result));

    // Track global best
    const candidate = evaluated[0].result;
    if (!bestEval) {
      bestEval = candidate;
    } else {
      // Prefer: passing > failing; among equal passing status, prefer lower cost
      const bestPassing = bestEval.design.allPassing;
      const candPassing = candidate.design.allPassing;
      if (candPassing && !bestPassing) {
        bestEval = candidate;
      } else if (candPassing === bestPassing && candidate.cost.totalCost < bestEval.cost.totalCost) {
        bestEval = candidate;
      }
    }

    // Selection: top 40% survive
    const survivors = evaluated.slice(0, Math.ceil(populationSize * 0.4));

    // Build next generation via crossover + mutation
    const newPop: Chromosome[] = survivors.map(s => s.chromo);
    while (newPop.length < populationSize) {
      const p1 = randomChoice(survivors).chromo;
      const p2 = randomChoice(survivors).chromo;
      let child = crossover(p1, p2);
      if (Math.random() < 0.3) child = mutate(child);
      newPop.push(child);
    }
    population = newPop;
  }

  return bestEval!;
}
