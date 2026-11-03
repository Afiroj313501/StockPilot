# Reports: definitions and rules

All figures are for COMPLETED sales and for returns, in the store's currency and time zone.
Every amount is a sum of 2-decimal values, so days, weeks, months, products and categories
always add up exactly. Dashboard, report tables and CSV exports call the same functions.

| Metric                  | Definition                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Period                  | Local calendar dates `from`..`to` inclusive in the store time zone (default: last 30 days). Weeks start on Monday, months on the 1st                                                                                         |
| Gross sales             | Sum of sale subtotals (before discounts and tax)                                                                                                                                                                             |
| Discounts               | Sum of sale discount totals                                                                                                                                                                                                  |
| Tax collected           | Sum of sale tax totals (also when prices include tax)                                                                                                                                                                        |
| Sales total             | Sum of sale totals (what customers paid)                                                                                                                                                                                     |
| Refunds, Tax refunded   | Sum of return refund totals and the tax inside them, by the day the return was recorded                                                                                                                                      |
| Net sales               | `(sales total - tax collected) - (refunds - tax refunded)`, excluding tax                                                                                                                                                    |
| Cost of goods sold      | Sum of `quantity x unit cost saved on the sale line` (each line rounded to cents), minus the same for returned units that were put back into stock. Returns that were not restocked (for example damaged items) stay as cost |
| Gross profit (estimate) | Net sales - cost of goods sold. An estimate, not audited accounting                                                                                                                                                          |
| Inventory value         | Per product `stock x (average cost, else cost price)` rounded to cents; negative stock counts as 0; archived products with stock are included                                                                                |

Cost method: moving weighted average. The unit cost (average cost, else cost price) is saved on every
sale line at the time of sale, so later cost changes never rewrite past profit.

Limits and warnings

- Sold lines with a saved cost of 0 are counted and shown as a warning (profit may be overstated).
- Category and product reports use each product's current category and the names saved on the sale.
- Amounts are added up as recorded; there is no currency conversion if the store currency changed.
- Daily grouping covers at most 366 days; any range at most 731 days.
- Time-zone handling follows the IANA database in the server's runtime, including daylight saving.

CSV exports (manager and owner only)

- `sales`, `products`, `categories`, `inventory`, `low-stock` (the 200 lowest products), `returns`, `purchases`.
- UTF-8 with a byte-order mark, CRLF line endings.
- Text cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` so spreadsheets
  cannot run them as formulas. Numeric columns are written as-is.
