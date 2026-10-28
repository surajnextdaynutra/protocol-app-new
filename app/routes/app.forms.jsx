import { useState } from "react";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, DataTable, InlineStack, Page, Select, Text, TextField } from "@shopify/polaris";

import { Pager, dateTime, paging, rx } from "../components/admin";
import { connectDb } from "../db.server";
import { FormEntry } from "../models/index.server";
import { authenticate } from "../shopify.server";

/* Form entries - the "Sales Referral Form Data" and "Contact Form
   Submissions" tabs. Every website form is saved here before it is emailed,
   so nothing is lost when an email fails. */

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  await connectDb();
  const { url, page, pageSize, skip } = paging(request, 25);
  const form = url.searchParams.get("form") || "contact";
  const q = (url.searchParams.get("q") || "").trim();
  const filter = { form };
  if (q) {
    const re = rx(q);
    filter.$or = [
      { email: re }, { "data.name": re }, { "data.providerName": re }, { "data.practiceName": re },
      { "data.contactEmail": re }, { "data.phone": re }, { "data.message": re },
    ];
  }
  const [rows, total, counts] = await Promise.all([
    FormEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    FormEntry.countDocuments(filter),
    FormEntry.aggregate([{ $group: { _id: "$form", n: { $sum: 1 } } }]),
  ]);
  return {
    form, q, page, pageSize, total,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    rows: rows.map((r) => ({ id: String(r._id), at: dateTime(r.createdAt), status: r.status, data: r.data || {} })),
  };
};

/** Which website form a contact entry came from, by the page it was sent on. */
function contactSource(pageUrl) {
  const u = String(pageUrl || "");
  if (/for-healthcare-professionals/i.test(u)) return "HCP page";
  if (/rx-physician-dashboard/i.test(u)) return "Physician dashboard";
  if (/\/pages\/contact/i.test(u)) return "Contact page";
  try {
    return new URL(u).pathname || "-";
  } catch {
    return u ? u.slice(0, 40) : "-";
  }
}

const REFERRAL_COLS = [
  ["Practice", (d) => d.practiceName], ["Contact", (d) => d.contactEmail], ["State", (d) => d.state],
  ["Physicians", (d) => d.numPhysicians], ["Plan", (d) => d.quotePlan], ["Rep", (d) => d.repName],
];
const CONTACT_COLS = [
  ["Name", (d) => d.name || d.providerName],
  ["Practice", (d) => [d.practiceName, d.organizationType].filter(Boolean).join(" · ")],
  ["Email", (d) => d.email],
  ["Phone", (d) => d.phone],
  ["Message", (d) => d.message],
  ["From", (d) => contactSource(d.pageUrl)],
];

const STATUS_TONE = { Emailed: "success", Notified: "success", "Not emailed": "warning" };

export default function Forms() {
  const data = useLoaderData();
  const [form, setForm] = useState(data.form);
  const [q, setQ] = useState(data.q);
  const [open, setOpen] = useState(null);
  const cols = data.form === "contact" ? CONTACT_COLS : REFERRAL_COLS;
  const n = (k) => data.counts[k] || 0;

  return (
    <Page title="Form entries" subtitle="Every website form submission, saved before it is emailed." fullWidth>
      <BlockStack gap="400">
        <Card>
          <Form method="get">
            <InlineStack gap="300" blockAlign="end" wrap>
              <Select label="Form" name="form" value={form} onChange={setForm}
                options={[
                  { label: `Contact / support (${n("contact")})`, value: "contact" },
                  { label: `New client / sales referral (${n("referral")})`, value: "referral" },
                ]} />
              <div style={{ minWidth: 280 }}>
                <TextField label="Search" name="q" value={q} onChange={setQ} placeholder="Name, email, practice, phone, message" autoComplete="off" />
              </div>
              <Button submit variant="primary">Show</Button>
            </InlineStack>
          </Form>
        </Card>
        <Card padding="0">
          <DataTable
            columnContentTypes={["text", ...cols.map(() => "text"), "text", "text"]}
            headings={["Received", ...cols.map((c) => c[0]), "Status", ""]}
            rows={data.rows.map((r) => [
              r.at,
              ...cols.map(([label, get]) => (
                <div key={label} style={{ maxWidth: 260, whiteSpace: "normal" }}>{String(get(r.data) ?? "")}</div>
              )),
              <Badge key={r.id + "s"} tone={STATUS_TONE[r.status]}>{r.status || "New"}</Badge>,
              <Button key={r.id} size="micro" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "Hide" : "All fields"}
              </Button>,
            ])}
          />
        </Card>
        {data.rows.filter((r) => r.id === open).map((r) => (
          <Card key={r.id}>
            <BlockStack gap="100">
              {Object.entries(r.data).map(([k, v]) => (
                <Text as="p" key={k}><b>{k}:</b> {String(v ?? "")}</Text>
              ))}
            </BlockStack>
          </Card>
        ))}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} />
      </BlockStack>
    </Page>
  );
}
