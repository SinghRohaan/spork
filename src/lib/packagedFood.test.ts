import { describe, expect, it, vi } from 'vitest'
import { extractGtin, lookupBarcode, parseGrams, productName, productToEstimate } from './packagedFood'

describe('extractGtin', () => {
  it('accepts EAN/UPC digits', () => {
    expect(extractGtin('8906042470150')).toBe('8906042470150')
    expect(extractGtin(' 12345670 ')).toBe('12345670')
  })
  it('reads a GS1 Digital Link QR', () => {
    expect(extractGtin('https://id.gs1.org/01/08906042470150/10/ABC')).toBe('08906042470150')
    expect(extractGtin('https://brand.example/01/08906042470150?x=1')).toBe('08906042470150')
  })
  it('rejects QR codes that are not products', () => {
    expect(extractGtin('https://yogabars.in/offers')).toBeNull()
    expect(extractGtin('upi://pay?pa=shop@okicici')).toBeNull()
  })
})

describe('parseGrams', () => {
  it('handles common pack sizes', () => {
    expect(parseGrams('60 g')).toBe(60)
    expect(parseGrams('60g')).toBe(60)
    expect(parseGrams('1 kg')).toBe(1000)
    expect(parseGrams('200 ml')).toBe(200)
    expect(parseGrams('Pack of 6')).toBeNull()
  })
})

describe('productName', () => {
  it('prefixes the brand once', () => {
    expect(productName({ brands: 'Yoga Bar', product_name: 'Protein Bar Chocolate Brownie' })).toBe('Yoga Bar Protein Bar Chocolate Brownie')
    expect(productName({ brands: 'Amul', product_name: 'Amul Masti Dahi' })).toBe('Amul Masti Dahi')
  })
})

describe('productToEstimate', () => {
  it('prefers per-serving label values', () => {
    const e = productToEstimate({
      brands: 'Yoga Bar', product_name: 'Protein Bar', serving_size: '60 g', serving_quantity: 60,
      nutriments: { 'energy-kcal_serving': 241.4, proteins_serving: 20.2, carbohydrates_serving: 24, fat_serving: 8.6, 'energy-kcal_100g': 402 },
    })!
    expect(e.parsed.items[0]).toMatchObject({ quantity: '1 serving (60 g)', grams: 60, calories: 241, protein_g: 20, confidence: 'high' })
    expect(e.parsed.calories).toBe(241)
  })

  it('scales per-100 g to a single-serve pack', () => {
    const e = productToEstimate({
      product_name: 'Peanut Chikki', quantity: '40 g',
      nutriments: { 'energy-kcal_100g': 500, proteins_100g: 15, carbohydrates_100g: 50, fat_100g: 25 },
    })!
    expect(e.parsed.items[0]).toMatchObject({ quantity: '1 pack (40 g)', grams: 40, calories: 200, protein_g: 6, fat_g: 10 })
  })

  it('falls back to 100 g for big packs and says so', () => {
    const e = productToEstimate({
      product_name: 'Oats', quantity: '1 kg',
      nutriments: { energy_100g: 1569, proteins_100g: 13 },   // kJ only
    })!
    expect(e.parsed.items[0]).toMatchObject({ quantity: '100 g', grams: 100, calories: 375 })
    expect(e.parsed.assumptions[0]).toMatch(/per 100 g/)
  })

  it('returns null without calories', () => {
    expect(productToEstimate({ product_name: 'Mystery', nutriments: { proteins_100g: 3 } })).toBeNull()
  })
})

describe('lookupBarcode', () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

  it('found → estimate', async () => {
    const r = await lookupBarcode('123', ok({ status: 1, product: { product_name: 'Bar', nutriments: { 'energy-kcal_serving': 200 } } }))
    expect(r.kind).toBe('found')
  })
  it('known product without nutrition → no-nutrition with its name', async () => {
    const r = await lookupBarcode('123', ok({ status: 1, product: { brands: 'Brand', product_name: 'Bar' } }))
    expect(r).toEqual({ kind: 'no-nutrition', name: 'Brand Bar' })
  })
  it('non-food products (beauty, pet food, household) → not-food', async () => {
    expect(await lookupBarcode('123', ok({ status: 1, product: { brands: 'Vaseline', product_name: 'Lip Care', product_type: 'beauty', nutriments: {} } })))
      .toEqual({ kind: 'not-food', name: 'Vaseline Lip Care' })
    expect((await lookupBarcode('123', ok({ status: 1, product: { product_name: 'Hair Oil', categories_tags: ['en:non-food-products'] } }))).kind).toBe('not-food')
    expect((await lookupBarcode('123', ok({ status: 1, product: { product_name: 'Bar', product_type: 'food', nutriments: { 'energy-kcal_serving': 200 } } }))).kind).toBe('found')
  })
  it('unknown product → not-found; network failure → error', async () => {
    expect((await lookupBarcode('123', ok({ status: 0 }))).kind).toBe('not-found')
    expect((await lookupBarcode('123', vi.fn(async () => { throw new Error('offline') }))).kind).toBe('error')
  })
})
