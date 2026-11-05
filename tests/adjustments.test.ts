import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyAdjustment } from '../shared/adjustments'
import { openLedger } from '../server/db/ledger'
import { insertAdjustment, latestAdjustmentsLookup, listAdjustmentsForFixture } from '../server/models/adjustments'

describe('質化調整', () => {
  it('百分點加在機率上，不取代原始值', () => {
    expect(applyAdjustment(0.45, 5)).toBeCloseTo(0.5)
    expect(applyAdjustment(0.45, -8)).toBeCloseTo(0.37)
    expect(applyAdjustment(null, 5)).toBeNull()
  })

  it('調整寫在獨立表，可並陳原始與調整後', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lottery-adj-'))
    const ledger = openLedger(join(dir, 'ledger.sqlite'))
    insertAdjustment(ledger, {
      fixtureId: 11,
      market: 'match',
      outcomeKey: 'away',
      deltaPct: 4,
      reasonCategory: 'injury',
      note: '客隊主力傷停',
    })
    insertAdjustment(ledger, {
      fixtureId: 11,
      market: 'match',
      outcomeKey: 'away',
      deltaPct: 2,
      reasonCategory: 'fatigue',
    })
    const listed = listAdjustmentsForFixture(ledger, 11)
    expect(listed).toHaveLength(2)
    expect(listed[0]?.deltaPct).toBe(2)
    const lookup = latestAdjustmentsLookup(ledger, 11, [
      { market: 'match', outcomeKey: 'away', raw: 0.4 },
    ])
    expect(lookup[0]?.adjustedProbability).toBeCloseTo(0.42)
    expect(lookup[0]?.deltaPct).toBe(2)
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
