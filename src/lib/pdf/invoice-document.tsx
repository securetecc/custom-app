import { Document, Page, Text, View, Image, Link } from "@react-pdf/renderer";
import { styles } from "./styles";
import { formatAddressLine, formatCurrency, formatDate, formatHours } from "@/lib/format";
import type { InvoicePdfData } from "./types";

/**
 * Invoice PDF -- laid out to match the org's canonical invoice template
 * (a full-bleed navy header/footer band, a single grid-lined line-item table,
 * a watermark, and a SUBTOTAL/TAX/TOTAL block paired with payment info).
 *
 * Multi-page handling:
 *  - The single <Page> paginates naturally; the line-item table is NOT
 *    chunked manually -- manual chunking is what usually causes duplicated
 *    headers and misplaced totals.
 *  - `headerBand` (logo + "INVOICE") and the letterhead/meta block render on
 *    page 1 only -- NOT `fixed`.
 *  - `footerBand` and `watermark` ARE `fixed`, so they repeat on every page.
 *  - The totals block is the last element in normal flow, so it renders once,
 *    on whatever page it naturally lands on. `wrap={false}` keeps it from
 *    splitting across a break, and `minPresenceAhead` stops it being orphaned
 *    at the very bottom of a page.
 *  - Each row is `wrap={false}` so a single row never splits across pages,
 *    while the containing list keeps default wrapping so the list itself can
 *    paginate.
 */
export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const { organization: org } = data;
  const clientAddressLine = formatAddressLine(data.client.address1, data.client.address2);
  const billerAddressLine = formatAddressLine(org.billerAddress1, org.billerAddress2);

  return (
    <Document title={`Invoice ${data.invoiceNumber}`}>
      <Page size="LETTER" style={styles.page}>
        {/* Header band -- page 1 only, not fixed. */}
        <View style={styles.headerBand}>
          {org.logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image is a drawing primitive, no alt prop.
            <Image src={org.logoDataUri} style={styles.logo} />
          ) : (
            <Text style={styles.orgNameFallback}>{org.name}</Text>
          )}
          <Text style={styles.invoiceTitle}>INVOICE</Text>
        </View>

        <View style={styles.content}>
          {/* Watermark -- fixed so it repeats behind every page. */}
          {org.logoDataUri && (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image is a drawing primitive, no alt prop.
            <Image src={org.logoDataUri} style={styles.watermark} fixed />
          )}

          {/* Letterhead (biller) + meta block. */}
          <View style={styles.letterheadRow}>
            <View style={styles.billerBlock}>
              {org.billerName && <Text style={styles.billerName}>{org.billerName}</Text>}
              {billerAddressLine.length > 0 && (
                <Text style={styles.billerLine}>{billerAddressLine}</Text>
              )}
              {org.billerCityStateZip && (
                <Text style={styles.billerLine}>{org.billerCityStateZip}</Text>
              )}
              {org.officePhone && <Text style={styles.billerLine}>Office: {org.officePhone}</Text>}
              {org.mobilePhone && <Text style={styles.billerLine}>Mobile: {org.mobilePhone}</Text>}
              {org.billerEmail && <Text style={styles.billerLine}>Email: {org.billerEmail}</Text>}
              {org.website && <Text style={styles.billerLine}>Website: {org.website}</Text>}
            </View>

            <View style={styles.metaBlock}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>DATE</Text>
                <Text style={styles.metaValue}>{formatDate(data.issuedAt)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>INVOICE #</Text>
                <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
              </View>
              <View style={[styles.metaRow, { marginTop: 8 }]}>
                <Text style={styles.metaLabel}>FOR:</Text>
                <Text style={styles.metaValueMuted}>{org.invoiceForLabel}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>PERIOD:</Text>
                <Text style={styles.metaValueMuted}>
                  {formatDate(data.periodStart)} – {formatDate(data.periodEnd)}
                </Text>
              </View>
              <View style={[styles.metaRow, { marginTop: 8 }]}>
                <Text style={styles.metaLabel}>BILL TO:</Text>
                <Text style={styles.metaValue}>{data.client.name}</Text>
              </View>
              <Text style={styles.metaValueMuted}>Attn: Accounting Department</Text>
              {clientAddressLine.length > 0 && (
                <Text style={styles.metaValueMuted}>{clientAddressLine}</Text>
              )}
              {data.client.cityStateZip && (
                <Text style={styles.metaValueMuted}>{data.client.cityStateZip}</Text>
              )}
              {data.client.phone && (
                <Text style={styles.metaValueMuted}>{data.client.phone}</Text>
              )}
            </View>
          </View>

          {/* Line-item table -- time entries, then any recurring/retainer rows. */}
          <View style={styles.tableHeaderRow} wrap={false}>
            <Text style={[styles.th, styles.colDate]}>DATE</Text>
            <Text style={[styles.th, styles.colDesc]}>DESCRIPTION</Text>
            <Text style={[styles.th, styles.colHours]}>HOURS</Text>
            <Text style={[styles.th, styles.colRate]}>RATE</Text>
            <Text style={[styles.th, styles.colAmount, { borderRightWidth: 0 }]}>AMOUNT</Text>
          </View>
          <View>
            {data.lineItems.map((item, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colDate]}>
                  {item.date ? formatDate(item.date) : ""}
                </Text>
                <Text style={[styles.cell, styles.colDesc]}>{item.description}</Text>
                <Text style={[styles.cell, styles.colHours]}>
                  {item.hours === null ? "" : formatHours(item.hours)}
                </Text>
                <Text style={[styles.cell, styles.colRate]}>
                  {item.rate === null ? "" : formatCurrency(item.rate)}
                </Text>
                <Text style={[styles.cell, styles.amountCell, styles.colAmount]}>
                  {item.amount === null ? "" : formatCurrency(item.amount)}
                </Text>
              </View>
            ))}
          </View>

          {/* Payment info (left) + totals (right). */}
          <View style={styles.bottomRow} wrap={false} minPresenceAhead={110}>
            <View style={styles.paymentInfo}>
              {(org.checkPayableTo || org.acceptedPaymentMethods) && (
                <>
                  {org.checkPayableTo && (
                    <Text style={styles.paymentLine}>
                      <Text style={styles.paymentLabel}>Make all checks payable to: </Text>
                      <Text style={styles.paymentValue}>{org.checkPayableTo}</Text>
                    </Text>
                  )}
                  {org.acceptedPaymentMethods && (
                    <Text style={styles.paymentLine}>
                      <Text style={styles.paymentLabel}>We also accept </Text>
                      <Text style={styles.paymentValue}>{org.acceptedPaymentMethods}</Text>
                      <Text style={styles.paymentLabel}>.</Text>
                    </Text>
                  )}
                </>
              )}
              <Text style={styles.thankYou}>THANK YOU FOR YOUR BUSINESS</Text>
            </View>

            <View style={styles.totalsBlock}>
              <View style={styles.totalsRowEmphasis}>
                <Text style={styles.totalsLabelEmphasis}>SUBTOTAL</Text>
                <Text style={styles.totalsValueEmphasis}>{formatCurrency(data.totalAmount)}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>TAX RATE</Text>
                <Text style={styles.totalsValue}>N/A</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>SALES TAX</Text>
                <Text style={styles.totalsValue}>N/A</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>OTHER</Text>
                <Text style={styles.totalsValue}>—</Text>
              </View>
              <View style={[styles.totalsRowEmphasis, { borderBottomWidth: 0 }]}>
                <Text style={styles.totalsLabelEmphasis}>TOTAL</Text>
                <Text style={styles.totalsValueEmphasis}>{formatCurrency(data.totalAmount)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Footer band -- fixed, repeats on every page. */}
        <View style={styles.footerBand} fixed>
          {org.website ? (
            <Link src={org.website} style={styles.footerLink}>
              {org.website}
            </Link>
          ) : (
            <Text style={styles.footerLink}>{org.name}</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
