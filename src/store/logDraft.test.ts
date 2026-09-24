import { beforeEach, describe, expect, it } from 'vitest'
import { useLogDraftStore } from './logDraft'
import type { EstimateResult } from './logDraft'

const item = (name: string, calories: number, protein_g = 10, carbs_g = 20, fat_g = 5) =>
  ({ name, quantity: '1 katori', grams: 150, calories, protein_g, carbs_g, fat_g, confidence: 'medium' as const })

function estimate(items: ReturnType<typeof item>[]): EstimateResult {
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => items.reduce((t, i) => t + i[k], 0)
  const parsed = {
    items, confidence: 'medium' as const, assumptions: [],
    calories: sum('calories'), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g'),
  }
  return { parsed, raw: parsed }
}

const s = () => useLogDraftStore.getState()

describe('log draft — editable AI items', () => {
  beforeEach(() => s().reset())

  it('seeds items and totals from the estimate', () => {
    s().applyEstimate(estimate([item('Rice', 360), item('Soy chunks curry', 250)]), 'lunch', 'public')
    expect(s().items).toHaveLength(2)
    expect(s().calories).toBe(610)
  })

  it('editing an item recomputes the totals and marks it edited', () => {
    s().applyEstimate(estimate([item('Rice', 360), item('Soy chunks curry', 250, 20)]), 'lunch', 'public')
    s().updateItem(1, { name: 'Prawn curry', calories: 200, protein_g: 24 })
    expect(s().items[1]).toMatchObject({ name: 'Prawn curry', edited: true })
    expect(s().calories).toBe(560)
    expect(s().proteinG).toBe(34)
  })

  it('remove and add adjust totals; portion multiplier scales the edited sum', () => {
    s().applyEstimate(estimate([item('Rice', 300), item('Curd', 100)]), 'lunch', 'public')
    s().removeItem(1)
    expect(s().calories).toBe(300)
    s().addItem({ ...item('Papad', 50), confidence: null })
    expect(s().calories).toBe(350)
    s().setPortionMultiplier(2)
    expect(s().calories).toBe(700)
  })

  it('removing the last item keeps the current totals instead of zeroing them', () => {
    s().applyEstimate(estimate([item('Rice', 300)]), 'lunch', 'public')
    s().removeItem(0)
    expect(s().calories).toBe(300)
  })

  it('re-estimate replaces items, keeps portion, and keeps a name the user typed', () => {
    s().applyEstimate(estimate([item('Rice', 300)]), 'lunch', 'public')
    s().setPortionMultiplier(1.5)
    s().setMealName('Sunday thali')
    s().applyReestimate(estimate([item('Rice', 300), item('Prawn curry', 200)]))
    expect(s().items.map((i) => i.name)).toEqual(['Rice', 'Prawn curry'])
    expect(s().calories).toBe(750)
    expect(s().mealName).toBe('Sunday thali')
    expect(s().items.some((i) => (i as { edited?: boolean }).edited)).toBe(false)
  })

  it('re-estimate refreshes a generated meal name', () => {
    s().applyEstimate(estimate([item('Rice', 300)]), 'lunch', 'public')
    const generated = s().mealName
    s().applyReestimate(estimate([item('Prawn curry', 200)]))
    expect(s().mealName).toBe(s().autoMealName)
    expect(generated).toBeTypeOf('string')
  })
})
