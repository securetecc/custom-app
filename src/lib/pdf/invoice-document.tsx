import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { styles } from "./styles";
import { formatAddressLine, formatCurrency, formatDate, formatHours } from "@/lib/format";
import type { InvoicePdfData } from "./types";

/**
 * Invoice PDF.
 *
 * Multi-page handling (the trickiest requirement in this phase) works like so:
 *
 *  - The single <Page> paginates naturally; the Work Log and line-item lists
 *    are NOT chunked manually. Manual chunking is what usually causes
 *    duplicated headers and misplaced totals.
 *  - Only the page-number footer is `fixed`. `fixed` repeats an element on
 *    EVERY page -- which is exactly the "duplicated totals" failure mode, so
 *    the totals block must never be fixed.
 *  - The totals block is the last element in normal flow, so it renders once,
 *    on whatever page it naturally lands on. `wrap={false}` keeps it from
 *    splitting across a break, and `minPresenceAhead` stops it being orphaned
 *    at the very bottom of a page.
 *  - Each row is `wrap={false}` so a single row never splits across pages,
 *    while the containing list keeps default wrapping so the list itself can
 *    paginate.
 */
export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const addressLine = formatAddressLine(data.client.address1, data.client.address2);
  const hasRecurring = data.monthlyCharges.length > 0 || data.annualCharges.length > 0;

  return (
    <Document title={`Invoice ${data.invoiceNumber}`}>
      <Page size="LETTER" style={styles.page}>
        {/* Header -- page 1 only. Not `fixed`, so it doesn't repeat. */}
        <View style={styles.headerRow}>
          <View>
            {data.organization.logoDataUri ? (
              /* react-pdf's Image is a PDF drawing primitive, not an HTML
                 <img> -- it has no alt prop for the a11y rule to check. */
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.organization.logoDataUri} style={styles.logo} />
            ) : (
              <Text style={styles.orgName}>{data.organization.name}</Text>
            )}
          </View>
          <View style={styles.invoiceMetaBlock}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.metaLine}>{data.invoiceNumber}</Text>
            <Text style={styles.metaLine}>{formatDate(data.issuedAt)}</Text>
            <Text style={styles.metaLine}>
              {formatDate(data.periodStart)} – {formatDate(data.periodEnd)}
            </Text>
          </View>
        </View>

        {/* Client billing block -- pulled live at generation time. */}
        <View style={styles.billBlock}>
          <Text style={styles.billLabel}>BILL TO</Text>
          <Text style={styles.billName}>{data.client.name}</Text>
          <Text style={styles.billLine}>ATTN: Accounting Department</Text>
          {addressLine.length > 0 && <Text style={styles.billLine}>{addressLine}</Text>}
          {data.client.cityStateZip && (
            <Text style={styles.billLine}>{data.client.cityStateZip}</Text>
          )}
          {data.client.phone && <Text style={styles.billLine}>{data.client.phone}</Text>}
        </View>

        {/* Line items */}
        {data.lineItems.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Services</Text>
            <View style={styles.tableHeader} wrap={false}>
              <Text style={[styles.th, styles.colDate]}>DATE</Text>
              <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
              <Text style={[styles.th, styles.colHours]}>HOURS</Text>
              <Text style={[styles.th, styles.colRate]}>RATE</Text>
              <Text style={[styles.th, styles.colAmount]}>AMOUNT</Text>
            </View>
            <View>
              {data.lineItems.map((item, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.bodyText, styles.colDate]}>{formatDate(item.date)}</Text>
                  <Text style={[styles.bodyText, styles.colDesc]}>{item.description}</Text>
                  <Text style={[styles.bodyText, styles.colHours]}>{formatHours(item.hours)}</Text>
                  <Text style={[styles.bodyText, styles.colRate]}>{formatCurrency(item.rate)}</Text>
                  <Text style={[styles.bodyText, styles.colAmount]}>
                    {formatCurrency(item.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Recurring charges -- bold, centered, clearly separated sections. */}
        {data.monthlyCharges.length > 0 && (
          <>
            <Text style={styles.centeredSectionHeading}>Monthly Recurring Charges</Text>
            {data.monthlyCharges.map((charge, i) => (
              <View key={i} style={styles.chargeRow} wrap={false}>
                <Text style={styles.bodyText}>{charge.description}</Text>
                <Text style={styles.bodyText}>{formatCurrency(charge.amount)}</Text>
              </View>
            ))}
          </>
        )}

        {data.annualCharges.length > 0 && (
          <>
            <Text style={styles.centeredSectionHeading}>Annual Recurring Charges</Text>
            {data.annualCharges.map((charge, i) => (
              <View key={i} style={styles.chargeRow} wrap={false}>
                <Text style={styles.bodyText}>{charge.description}</Text>
                <Text style={styles.bodyText}>{formatCurrency(charge.amount)}</Text>
              </View>
            ))}
          </>
        )}

        {/* Detailed Work Log -- every entry, full uncondensed description. */}
        {data.lineItems.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Detailed Work Log</Text>
            <View>
              {data.lineItems.map((item, i) => (
                <View key={i} style={styles.workLogRow} wrap={false}>
                  <Text style={[styles.bodyText, styles.workLogDate]}>
                    {formatDate(item.date)}
                  </Text>
                  <Text style={[styles.bodyText, styles.workLogDesc]}>{item.description}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Service Summary -- same bodyText token as the Work Log above. */}
        <Text style={styles.sectionHeading}>Service Summary</Text>
        <Text style={styles.bodyText}>{data.serviceSummary}</Text>

        {/* Totals: last in flow, never `fixed`, kept whole. */}
        <View style={styles.totalBlock} wrap={false} minPresenceAhead={80}>
          <Text style={styles.totalLabel}>Total Due</Text>
          <Text style={styles.totalAmount}>{formatCurrency(data.totalAmount)}</Text>
        </View>
        <Text style={styles.totalsSubLine}>
          {formatHours(data.totalHours)} billable hours
          {hasRecurring ? " · includes recurring charges" : ""}
        </Text>

        {/* The only `fixed` element -- intentionally repeats on every page. */}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${data.organization.name}${
              data.organization.phone ? ` · ${data.organization.phone}` : ""
            }   —   Invoice ${data.invoiceNumber}   —   Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
