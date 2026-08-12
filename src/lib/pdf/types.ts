/**
 * Plain, fully-serializable shape handed to the PDF renderer.
 *
 * Prisma `Decimal` and `Date` values are converted to number/ISO-string
 * *before* crossing this boundary -- @react-pdf/renderer receives this in a
 * React tree, and Decimal objects don't render or serialize predictably.
 */

export type InvoicePdfLineItem = {
  date: string; // ISO date
  description: string;
  hours: number;
  rate: number;
  amount: number;
};

export type InvoicePdfRecurringCharge = {
  description: string;
  amount: number;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  issuedAt: string; // ISO date
  periodStart: string; // ISO date
  periodEnd: string; // ISO date

  organization: {
    name: string;
    logoDataUri: string | null;
    phone: string | null;
    brandColorPrimary: string;
    brandColorAccent: string;
  };

  client: {
    name: string;
    address1: string | null;
    address2: string | null;
    cityStateZip: string | null;
    phone: string | null;
  };

  lineItems: InvoicePdfLineItem[];
  monthlyCharges: InvoicePdfRecurringCharge[];
  annualCharges: InvoicePdfRecurringCharge[];

  serviceSummary: string;

  totalHours: number;
  totalAmount: number;
};
