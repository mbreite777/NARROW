# Step 3A — Stripe Dashboard Setup (Revised: Free / Pro Model)

## Products & Prices to Create

Go to **Stripe Dashboard → Products** and create these two products:

| Product Name | Price | Interval | Notes |
|---|---|---|---|
| Contractor — Pro | $99.00 | Monthly | Recurring |
| Lender — Featured Placement | $8,000.00 | Yearly | Recurring |

After creating each product, copy its **Price ID** (starts with `price_`).

Note: Free contractor accounts don't touch Stripe at all — no product needed.

## Supabase Secrets to Set

Run these in your terminal (or set in Supabase Dashboard → Edge Functions → Secrets):

```bash
supabase secrets set STRIPE_PRICE_CONTRACTOR_PRO=price_xxxxxxxxxxxxx
supabase secrets set STRIPE_PRICE_LENDER_ANNUAL=price_xxxxxxxxxxxxx
```

You can remove the old three-tier secrets if you previously set them:
- `STRIPE_PRICE_CONTRACTOR_LISTING` — no longer used
- `STRIPE_PRICE_CONTRACTOR_LEAD` — no longer used
- `STRIPE_PRICE_CONTRACTOR_BID` — no longer used

## Webhook Endpoint

Go to **Stripe Dashboard → Developers → Webhooks**. If you already have an endpoint
pointing to your stripe-webhook function, just add the new events. Otherwise create one:

- **URL:** `https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/stripe-webhook`
- **Events to listen to:**
  - `checkout.session.completed` (existing — plan purchases)
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

If you don't already have `STRIPE_WEBHOOK_SECRET` set, copy the Webhook Signing Secret
(starts with `whsec_`) and set it:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

## Deploy Edge Functions

```bash
supabase functions deploy create-subscription
supabase functions deploy stripe-webhook
```

## Architect & Free Contractor Billing

No action needed. Architects remain free. Free contractor accounts never touch Stripe.
The `create-subscription` function only accepts `contractor_pro` and `lender_annual` —
any other tier value is rejected with a 400 error.

## Future: Adding More Tiers

To add tiers later (e.g. splitting Pro into Listing / Lead Access / Bid Management):
1. Create new products & prices in Stripe Dashboard
2. Add entries to PRICE_MAP in `create-subscription.ts`
3. Update feature gating logic in `main.js` (simple boolean → tiered check)
4. Update pricing UI on `professionals.html`
5. The database already supports multiple tier names — no migration needed
