# Smart Reorder Planner: how it works

The planner is deterministic. For the same data and the same parameters it always gives the same
answer, and every recommendation carries the inputs and the calculation steps that produced it.
It works without any AI provider.

## Inputs (per product)

- Current sellable stock (`Product.stockQuantity`). There are no stock reservations in StockPilot,
  so on-hand stock is sellable stock. Negative stock (if the store allows it) is used as it is.
- Eligible units = units sold in the window minus units returned in the window, never below 0.
  Sales are COMPLETED sales by sale date; returns count on the day they were recorded. Returned
  units reduce demand whether or not they went back into stock. Cancelled or voided sales never count.
- Observed days = min(windowDays, days since the product was created, counting today). A product
  younger than the window is not penalised for days before it existed.
- Lead time = the preferred supplier's lead time, otherwise the store default. The preferred supplier is
  the supplier on the product's most recent submitted, approved or received purchase order.
- Incoming = remaining quantity (ordered minus received) on APPROVED and PARTIALLY_RECEIVED orders.
  Draft and submitted orders are shown separately and are NOT counted (they may never be approved).
- Parameters (request values, defaults in brackets): windowDays [30, 7..180], safetyDays [3, 0..60],
  coverageDays [14, 0..180]. They are not saved per store yet.

## Calculation (whole numbers; each component rounded up on its own)

    average daily demand = eligible units / observed days
    lead-time demand     = ceil(average x lead time days)
    safety stock         = ceil(average x safety days)
    coverage stock       = ceil(average x coverage days)
    reorder point        = lead-time demand + safety stock
    order-up-to level    = reorder point + coverage stock      (every unit counted once)
    stock position       = current stock + incoming
    recommended quantity = order-up-to level - position   if demand > 0 and position <= reorder point
                           0                              otherwise

## Urgency and confidence

- CRITICAL: a reorder is recommended and stock is 0 or less, or stock lasts fewer days than the lead time.
- HIGH: a reorder is recommended otherwise.
- Confidence: INSUFFICIENT under 7 observed days or fewer than 3 sales (no quantity is recommended, but a
  product at or below its low-stock threshold is still listed); LOW under 14 days or 10 sales;
  MEDIUM under 28 days; otherwise HIGH.

## Acting on a recommendation

- "Create draft order": creates a DRAFT purchase order for the quantity (default: the recommendation)
  at the product's cost price, expected on today + lead time. It runs in one transaction with a row lock
  and an idempotency key. It never contacts a supplier. A product with a planner draft or submitted order
  still waiting cannot get another one.
- "Dismiss" / "Mark as reviewed": hide the product for 7 days. A cancelled planner order brings it back.
- Every decision stores a snapshot of the full recommendation (inputs, figures, steps) in `reorder_reviews`.

## Limits

- A flat average: no trend, seasonality, promotions or price changes.
- Days when the product was out of stock are not adjusted for, so they understate demand.
- Pack sizes, minimum order quantities and supplier price breaks are not modelled.
- Evaluates every active product per request (fine for small catalogues).
