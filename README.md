# InvoiceDesk

Fair-code invoicing for small businesses and freelancers, with team logins.

- **Self-host it free** for your own personal or business use (instructions below).
- **Or use our cloud** at [invoicedesk-eight.vercel.app](https://invoicedesk-eight.vercel.app): $25 a year per business, with a 14-day free trial and no card needed.
- **Or just try the [demo](https://invoicedesk-eight.vercel.app/demo/)** with no signup. It runs entirely in your browser and is wiped after an hour.

- **Team logins**: one admin invites team members by email.
- **Permissions**: members create invoices, customers and items and record payments, but **cannot delete** anything.
  Editing a saved invoice is allowed for members only when the admin turns on *“Members can edit saved invoices”*.
- **Customers and items**: save them once and pick them on invoices. Item prices are defaults; change them on any invoice.
- **Payment methods**: UPI ID (with an automatic QR code for the exact amount), QR image, phone number, payment link, Zelle, bank transfer or a custom method.
  Choose which ones appear on each invoice. On fully paid invoices they are hidden automatically; the admin can change this.
- **Record payments**: cash, bank transfer, UPI, card, cheque and more, with partial payments, references and notes.
  Balance and status (Unpaid, Partly paid, Paid, Overdue) update automatically.
- **Reports**: invoiced, received, pending, overdue, collection rate, average days to get paid, earnings by customer,
  monthly chart, unpaid invoices by age, received by payment method, top items and invoices by team member. Everything exports to CSV.
- **PDF and print**: clean A4 or Letter invoices with your logo, and a PAID stamp when settled.
- Multi-currency, GST/VAT/tax, discounts, shipping, invoice prefixes and automatic numbering.

It's plain HTML, CSS and JavaScript with no build step. Data and logins are in [Supabase](https://supabase.com),
and every permission is enforced by the database (row level security), not just hidden in the UI.

## Set up your own copy (about 10 minutes, free)

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (the free plan is enough).
2. **Create the database:** in your project open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. **Connect the app:** go to **Project Settings → API** and copy the *Project URL* and the *publishable* (or *anon*) key into [`config.js`](config.js).
4. **Deploy:** any static host works. On Vercel, click *Add New → Project*, import your fork, and deploy with no build settings.
   Netlify, Cloudflare Pages, GitHub Pages or Hostinger also work: just upload the files.
5. **Set your site address in Supabase:** go to **Authentication → URL Configuration**, set *Site URL* to your app's address (for example `https://your-app.vercel.app`),
   and add `https://your-app.vercel.app/app/` under *Redirect URLs*. Email confirmation and password reset links use it.
6. **Set up email delivery:** Supabase's built-in email only reaches your own Supabase team's addresses and sends just a few emails an hour.
   For real users, go to **Authentication → Emails → SMTP Settings** and add a free SMTP provider such as Resend, Brevo or Amazon SES.
7. Open `https://your-app.vercel.app/app/`, **create an account**, and create your business. You are its admin.

That is all. A self-hosted copy has **no billing, trials or limits**.

### Adding your team

In **Team**, invite a person's email address. They open the app, **create an account with that same email**, and confirm it.
They join your team automatically. Invites only work for confirmed email addresses, so keep *Confirm email* turned on in Supabase.

## Who can do what

| | Admin | Member |
|---|:---:|:---:|
| Create invoices, record payments | ✅ | ✅ |
| Add and edit customers and items | ✅ | ✅ |
| Edit a saved invoice | ✅ | Only if the admin allows it |
| Delete invoices, payments, customers or items | ✅ | ❌ |
| Manage payment methods | ✅ | ❌ (can use them) |
| Team, roles and business settings | ✅ | ❌ |
| View reports | ✅ | ✅ |

## Project layout

```
index.html            sends visitors to the app
app/index.html        the app: sign in, onboarding, navigation
config.js             your Supabase URL and publishable key
assets/app.css        app styles, including the printable invoice
assets/js/main.js     sign in, routing, business switching
assets/js/db.js       Supabase client and shared helpers
assets/js/doc.js      invoice layout, PDF export, UPI QR codes
assets/js/views/      one file per page (invoices, customers, items, payment methods, reports, team, settings)
supabase/schema.sql   tables, permission rules and functions
```

To run it locally, serve the folder with any static server, for example `npx http-server . -p 5180`, and open http://localhost:5180 (the app is at /app/).
Add `http://localhost:5180` to the Supabase *Redirect URLs* if you want email links to come back to your machine.

## License

InvoiceDesk is **fair-code**, distributed under the [Sustainable Use License](LICENSE), like n8n. The source is public, but it is not an OSI open-source license.

- ✅ Use it and change it for yourself or for your own business, free.
- ✅ Share it free of charge, together with the license.
- ❌ Sell it, resell it, or charge anyone for access to it.
- ❌ Host it for other people or businesses as a service (SaaS), paid or free.

For anything else, ask for a commercial license.
