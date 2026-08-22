/**
 * Plain, fully-serializable shape handed to the PDF renderer.
 *
 * Prisma `Decimal` and `Date` values are converted to number/ISO-string
 * *before* crossing this boundary -- @react-pdf/renderer receives this in a
 * React tree, and Decimal objects don't render or serialize predictably.
 */

/**
 * One row in the invoice's single line-item table.
 *
 * Time entries populate every field. Recurring-charge and Retainer rows
 * (folded into the same table, matching the master invoice template) leave
 * `date`, `hours`, and `rate` null -- they aren't tied to a single day or an
 * hourly rate, only `description` and `amount` apply.
 */
export type InvoicePdfLineItem = {
  date: string | null; // ISO date
  description: string;
  hours: number | null;
  rate: number | null;
  amount: number | null;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  issuedAt: string; // ISO date
  periodStart: string; // ISO date
  periodEnd: string; // ISO date

  organization: {
    name: string;
    logoDataUri: string | null;

    // Invoice letterhead -- an individual biller's info, distinct from `name`
    // above. Each is null until Settings → Organization → Invoice letterhead
    // is filled in, and the PDF simply omits the corresponding line.
    billerName: string | null;
    billerAddress1: string | null;
    billerAddress2: string | null;
    billerCityStateZip: string | null;
    officePhone: string | null; // sourced from Organization.phone
    mobilePhone: string | null;
    billerEmail: string | null;
    website: string | null;
    invoiceForLabel: string; // "FOR:" row -- pre-resolved to "IT Services" fallback
    checkPayableTo: string | null;
    acceptedPaymentMethods: string | null;
  };

  client: {
    name: string;
    address1: string | null;
    address2: string | null;
    cityStateZip: string | null;
    phone: string | null;
  };

  lineItems: InvoicePdfLineItem[];

  totalHours: number;
  totalAmount: number;
};
