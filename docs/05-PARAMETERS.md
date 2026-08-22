# 05 — Parameter seed

Every operating value in the system. Load these in M0. **No component ever hardcodes any of them.**

Source of truth: **G7 Operations Manual v1.2, Appendix A**, with food-safety values from **Appendix G**. If the manual and this file disagree, the manual wins.

## Reading the table

- `value: null` means **deliberately unset**. The UI shows "not set", never a fallback. Do not fill these in.
- `signoff: yes` means the value carries food-safety or legal weight and needs professional sign-off before it is relied upon.

## Branch and time

| key | value | type | owner | signoff |
|---|---|---|---|---|
| `branch.operating_mode` | `scheduled` | enum | owner | |
| `branch.open_time` | `06:00` | time | owner | |
| `branch.close_time` | `24:00` | time | owner | |
| `branch.business_day_cutoff` | `24:00` | time | owner | |
| `session.pin_timeout_minutes` | 15 | duration_minutes | store_manager | |

## Service

| key | value | type | min | max | owner |
|---|---|---|---|---|---|
| `service.greeting_seconds` | 3 | number | 1 | 10 | store_manager |
| `service.checkout_target_seconds` | 30 | number | 10 | 120 | store_manager |
| `service.queue_second_till_threshold` | 5 | number | 2 | 15 | store_manager |

## Fees

| key | value | type | owner |
|---|---|---|---|
| `fee.cooking_fee_regular` | 4000 | currency (centavos) | owner |
| `fee.cooking_fee_student` | 3500 | currency (centavos) | owner |
| `fee.cooking_fee_basis` | `per_transaction` | enum | owner |
| `fee.student_proof_required` | `uniform_or_school_id` | enum | store_manager |

> Currency is stored in **centavos as integers**. ₱40.00 is `4000`.

## Cash

| key | value | type | min | max | owner |
|---|---|---|---|---|---|
| `cash.drawer_max_balance` | 300000 | currency | 100000 | 1000000 | owner |
| `cash.drawer_alert_threshold` | 250000 | currency | 50000 | 900000 | store_manager |
| `cash.drawer_max_after_2200` | 200000 | currency | 50000 | 500000 | owner |
| `cash.opening_float` | 200000 | currency | 50000 | 500000 | store_manager |
| `cash.drop_interval_minutes` | 180 | duration_minutes | 60 | 480 | store_manager |
| `cash.variance_investigation_threshold` | 10000 | currency | 1000 | 100000 | store_manager |
| `cash.shift_leader_approval_limit` | 50000 | currency | 10000 | 200000 | owner |
| `cash.owner_writeoff_threshold` | null | currency | | | owner |

## Cleaning and checks

| key | value | type | owner |
|---|---|---|---|
| `clean.ramyeon_station_interval_minutes` | 30 | duration_minutes | store_manager |
| `clean.dining_check_interval_minutes` | 20 | duration_minutes | store_manager |
| `clean.general_check_interval_minutes` | 60 | duration_minutes | store_manager |

## Cold chain — equipment

| key | value | type | owner | signoff |
|---|---|---|---|---|
| `equipment.temperature_reading_interval_minutes` | 180 | duration_minutes | store_manager | |
| `equipment.reading_grace_minutes` | 45 | duration_minutes | store_manager | |
| `equipment.chiller_target_max_c` | 4 | temperature_c | owner | **yes** |
| `equipment.freezer_target_max_c` | **null** | temperature_c | owner | **yes** |
| `equipment.max_excursion_minutes` | **null** | duration_minutes | owner | **yes** |

> **`equipment.freezer_target_max_c` and `equipment.max_excursion_minutes` are deliberately unset.** They come from the technician and the manufacturer specification for the replacement freezer. **Do not seed a number.** With `max_excursion_minutes` unset, auto-quarantine does not fire — the Shift Leader is prompted instead. That behaviour is specified in `04-M1-COLDCHAIN.md` and is correct.

## Food safety — Manual Appendix G

| key | value | type | owner | signoff | basis |
|---|---|---|---|---|---|
| `food.hot_holding_min_c` | 60 | temperature_c | owner | **yes** | PD 856 legal minimum |
| `food.cold_holding_max_c` | 4 | temperature_c | owner | **yes** | G7 standard; legal minimum is 7 |
| `food.cooling_to_chiller_max_minutes` | 120 | duration_minutes | owner | **yes** | Target 60 |
| `food.cooling_target_minutes` | 60 | duration_minutes | owner | **yes** | |
| `food.reheat_min_c` | 74 | temperature_c | owner | **yes** | |
| `food.reheat_max_count` | 1 | number | owner | **yes** | Once only |
| `food.hot_hold_max_minutes` | 240 | duration_minutes | owner | **yes** | 4 hours, then discard |
| `food.cooked_rice_useby_hours` | 24 | duration_minutes ×60 | owner | **yes** | Same trading day, max 24h |
| `food.gimbap_useby_hours` | 24 | number | owner | **yes** | Same trading day |
| `food.boiled_egg_useby_hours` | 24 | number | owner | **yes** | |
| `food.prepped_filling_useby_hours` | 24 | number | owner | **yes** | |
| `food.fried_items_permitted` | **false** | boolean | owner | **yes** | **See below** |

> **`food.fried_items_permitted` seeds as `false` deliberately.** The sanitary permit states no scope and the fire requirements for frying are unconfirmed. Manual Appendix G.5 says fried items are not sold until both are answered in writing. **Flip this to `true` only when the Owner confirms both sign-offs are in hand.**

## Ambience

| key | value | type | owner |
|---|---|---|---|
| `audio.quiet_hours_start` | `00:00` | time | store_manager |
| `audio.quiet_hours_end` | `06:00` | time | store_manager |

## Staffing

| key | value | type | owner |
|---|---|---|---|
| `staff.headcount_target` | 9 | number | owner |
| `staff.seats_indoor` | 36 | number | owner |
| `staff.seats_outdoor` | 12 | number | owner |
| `staff.night_diff_start` | `22:00` | time | owner |
| `staff.night_diff_end` | `06:00` | time | owner |
| `staff.night_diff_rate_pct` | 10 | number | owner |
| `staff.probation_months` | 6 | number | owner |
| `staff.leave_eligibility_months` | 6 | number | owner |
| `staff.statutory_sil_eligibility_months` | 12 | number | owner |
| `staff.certification_expiry_warning_days` | **null** | number | owner |

> **Company leave and statutory SIL are separate entitlements.** G7 grants leave at regularisation (6 months); statutory Service Incentive Leave accrues at 12 months. An employer may exceed the statutory floor, never fall below it. Keep both configurable and keep them distinct.

> **`staff.certification_expiry_warning_days` is deliberately unset.** Added for M8's dashboard ("certifications expiring"), which needs a window to count against — no such window exists in the manual yet. With it unset, the dashboard shows "not set" for that tile rather than inventing a number, the same rule as every other unset parameter here.

## Inventory — reserved, later phase

| key | value | type | owner |
|---|---|---|---|
| `inventory.near_expiry_days_chilled` | null | number | store_manager |
| `inventory.near_expiry_days_ambient` | null | number | store_manager |

## Seed shape

```ts
{
  key: 'cash.drawer_max_balance',
  scope: 'global', scopeId: null,
  value: 300000, dataType: 'currency',
  minAllowed: 100000, maxAllowed: 1000000, unit: 'PHP_centavos',
  ownerRole: 'owner',
  effectiveFrom: Timestamp.now(), effectiveTo: null,
  changedBy: 'seed', changedAt: Timestamp.now(),
  reason: 'Initial seed from Operations Manual v1.2 Appendix A',
  requiresProfessionalSignoff: false
}
```

## Seed test

After seeding, assert:

- [ ] `cash.drawer_max_balance` → 300000, displays as **₱3,000.00**
- [ ] `food.hot_holding_min_c` → 60
- [ ] `equipment.freezer_target_max_c` → `isSet === false`, and **no number renders anywhere in the UI**
- [ ] `equipment.max_excursion_minutes` → `isSet === false`, and **auto-quarantine does not fire**
- [ ] `food.fried_items_permitted` → `false`
- [ ] Every parameter with `signoff: yes` is flagged in the manager UI
