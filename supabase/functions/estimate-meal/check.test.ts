import { describe, expect, it } from 'vitest'
import { checkEstimate, finalizeEstimate, type EstItem } from './index.ts'

const item = (over: Partial<EstItem>): EstItem => ({
  name: 'Dal', quantity: '1 katori', grams: 150, calories: 165, protein_g: 9, carbs_g: 22, fat_g: 4.5,
  fiber_g: 4.5, added_sugar_g: 0, sat_fat_g: 1, alcohol_g: 0, group: 'pulse', fried: false, confidence: 'medium', ...over,
})
const answer = (items: EstItem[], extra: Record<string, unknown> = {}) =>
  ({ is_food: true, items, calories: 999, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: 'high', assumptions: [], ...extra })

describe('checkEstimate', () => {
  it('passes a consistent answer and makes totals the item sum', () => {
    const { estimate, issues } = checkEstimate(answer([item({}), item({ name: 'Rice', grams: 150, calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0.5, fiber_g: 0.6, group: 'refined_grain' })]), 'meal')
    expect(issues).toEqual([])
    expect(estimate!.calories).toBe(360)
  })
  it('flags calories that do not match the macros', () => {
    const { issues } = checkEstimate(answer([item({ calories: 400 })]), 'meal')
    expect(issues[0]).toMatch(/doesn't match its macros/)
  })
  it('counts alcohol at 7 kcal/g, so spirits pass', () => {
    const vodka = item({ name: 'Vodka', grams: 375, calories: 862, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, alcohol_g: 118, group: 'alcohol' })
    expect(checkEstimate(answer([vodka]), 'meal').issues).toEqual([])
  })
  it('flags an alcoholic drink with no alcohol, but not alcohol-free beer', () => {
    const beer = (name: string) => item({ name, grams: 330, calories: 140, protein_g: 1, carbs_g: 34, fat_g: 0, fiber_g: 0, sat_fat_g: 0, group: 'alcohol' })
    expect(checkEstimate(answer([beer('Kingfisher beer')]), 'meal').issues.some((x) => x.includes('alcohol_g'))).toBe(true)
    expect(checkEstimate(answer([beer('Alcohol-free beer')]), 'meal').issues).toEqual([])
  })
  it('flags calories per gram that are impossible for the food (misidentification)', () => {
    const { issues } = checkEstimate(answer([item({ name: 'Salad', grams: 100, calories: 450, protein_g: 5, carbs_g: 20, fat_g: 39, group: 'vegetable' })]), 'meal')
    expect(issues.some((x) => x.includes('kcal per gram is not possible for vegetable'))).toBe(true)
  })
  it('flags nutrients that weigh more than the food, and fibre / sugar / sat fat over their parents', () => {
    const { issues } = checkEstimate(answer([item({ grams: 20, fiber_g: 30, added_sugar_g: 25, sat_fat_g: 8 })]), 'meal')
    expect(issues.join('\n')).toMatch(/weigh more than the food/)
    expect(issues.join('\n')).toMatch(/fibre .* can't exceed carbs/)
    expect(issues.join('\n')).toMatch(/added sugar .* can't exceed carbs/)
    expect(issues.join('\n')).toMatch(/saturated fat .* can't exceed fat/)
  })
  it('is looser for printed labels', () => {
    const bar = item({ name: 'Protein bar', grams: 60, calories: 210, protein_g: 20, carbs_g: 22, fat_g: 7, group: 'protein_supplement' }) // 4/4/9 → 231
    expect(checkEstimate(answer([bar]), 'packaged').issues).toEqual([])
  })
  it('handles junk safely', () => {
    expect(checkEstimate(null, 'meal').estimate).toBeNull()
    expect(checkEstimate(answer([{ name: 'x', calories: -5, protein_g: Number.NaN } as unknown as EstItem]), 'meal').estimate!.items[0]).toMatchObject({ calories: 0, protein_g: 0 })
    expect(checkEstimate({ is_food: false, not_food_reason: 'Lip balm' }, 'meal')).toMatchObject({ issues: [], estimate: { calories: 0, items: [] } })
    expect(checkEstimate(answer([]), 'meal').issues).toContain('No items were listed')
  })
})

describe('finalizeEstimate', () => {
  it('sets calories from the macros when they still disagree, and marks the estimate low-confidence', () => {
    const { estimate, issues } = checkEstimate(answer([item({ calories: 400 })]), 'meal')
    const out = finalizeEstimate(estimate!, 'meal', issues)
    expect(out.items[0].calories).toBe(165) // 4×9 + 4×22 + 9×4.5
    expect(out.calories).toBe(165)
    expect(out.confidence).toBe('low')
    expect(out.assumptions!.at(-1)).toMatch(/adjusted so they add up/)
  })
  it('keeps printed label calories, clamps impossible detail', () => {
    const { estimate, issues } = checkEstimate(answer([item({ name: 'Biscuits', calories: 300, fiber_g: 40, group: 'sweet', grams: 100 })]), 'packaged')
    const out = finalizeEstimate(estimate!, 'packaged', issues)
    expect(out.items[0].calories).toBe(300)
    expect(out.items[0].fiber_g).toBe(22)
  })
  it('leaves a clean answer untouched', () => {
    const { estimate, issues } = checkEstimate(answer([item({})]), 'meal')
    expect(finalizeEstimate(estimate!, 'meal', issues)).toBe(estimate)
  })
})
