import { StyleSheet } from "@react-pdf/renderer";

// These match the org's default brandColorPrimary/brandColorAccent exactly
// (see Organization model) -- kept as static constants rather than piped
// through per-render since nothing today overrides those defaults for PDFs.
export const NAVY = "#071E37";
export const TEAL = "#06E1DC";
export const AMOUNT_TINT = "#BFFDFC";
export const RULE = "#9FB2C2";
export const MUTED = "#5B6B7C";

export const BODY_FONT_SIZE = 9;

/**
 * Layout note: the master template's header and footer are full-bleed bands
 * that touch the page edge, which react-pdf's `Page` padding can't do (padding
 * insets the whole content box uniformly). So `page` itself carries zero
 * padding, `headerBand`/`footerBand` span it edge-to-edge, and everything
 * else lives inside `content`, which supplies its own horizontal inset.
 *
 * Pagination discipline (unchanged from before this redesign): rows are
 * `wrap={false}` so one row never splits across a page break; the totals
 * block is `wrap={false}` with `minPresenceAhead` so it's never orphaned at a
 * page bottom, and it is NOT `fixed` -- it renders once, wherever it lands.
 * `headerBand` renders on page 1 only (not fixed); `footerBand` and
 * `watermark` are `fixed` so they repeat on every page.
 */
export const styles = StyleSheet.create({
  page: {
    paddingBottom: 60, // reserves room for the fixed footer band
    fontSize: BODY_FONT_SIZE,
    fontFamily: "Helvetica",
    color: NAVY,
  },
  content: {
    paddingHorizontal: 40,
    paddingTop: 20,
  },

  bodyText: {
    fontSize: BODY_FONT_SIZE,
    lineHeight: 1.45,
    color: NAVY,
  },

  // --- header band ----------------------------------------------------------
  headerBand: {
    backgroundColor: NAVY,
    paddingHorizontal: 40,
    paddingVertical: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logo: { width: 150 },
  orgNameFallback: { fontSize: 16, fontFamily: "Helvetica-Bold", color: TEAL },
  invoiceTitle: { fontSize: 26, fontFamily: "Helvetica-Bold", color: TEAL },

  // --- letterhead / meta row --------------------------------------------------
  letterheadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  billerBlock: { maxWidth: "55%" },
  billerName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  billerLine: { fontSize: 8, color: NAVY, lineHeight: 1.4 },

  metaBlock: { alignItems: "flex-end" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 2,
  },
  metaLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-BoldOblique",
    color: "#003366",
    marginRight: 8,
  },
  metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY, textAlign: "right" },
  metaValueMuted: { fontSize: 9, color: NAVY, textAlign: "right" },

  // --- watermark --------------------------------------------------------------
  // Fixed pixel offsets (LETTER = 612x792pt) rather than percentages: this
  // needs to clear the header band + letterhead/meta block and land centered
  // in the table area below it, which a percentage of page height can't
  // target precisely.
  watermark: {
    position: "absolute",
    top: 330,
    left: 176,
    width: 260,
    opacity: 0.05,
  },

  // --- line-item table (grid-lined, matching the source spreadsheet) --------
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: TEAL,
    borderTopWidth: 1,
    borderTopColor: NAVY,
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
  },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    textAlign: "center",
    paddingVertical: 5,
    borderRightWidth: 0.5,
    borderRightColor: NAVY,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  cell: {
    fontSize: BODY_FONT_SIZE,
    color: NAVY,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 0.5,
    borderRightColor: RULE,
  },
  amountCell: { backgroundColor: AMOUNT_TINT, borderRightWidth: 0 },

  colDate: { width: "15%" },
  colDesc: { width: "45%" },
  colHours: { width: "12%", textAlign: "right" },
  colRate: { width: "11%", textAlign: "right" },
  colAmount: { width: "17%", textAlign: "right" },

  // --- totals + payment info row ---------------------------------------------
  bottomRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },

  paymentInfo: { maxWidth: "55%" },
  paymentLine: { fontSize: 9, textAlign: "center", marginBottom: 2 },
  paymentLabel: { fontFamily: "Helvetica-Bold", color: NAVY },
  paymentValue: { fontFamily: "Helvetica-Bold", color: "#003366" },
  thankYou: {
    marginTop: 8,
    fontSize: 11,
    fontFamily: "Helvetica-BoldOblique",
    textAlign: "center",
    color: NAVY,
  },

  totalsBlock: { width: 200 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 3,
  },
  totalsRowEmphasis: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: AMOUNT_TINT,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  totalsLabel: { fontSize: 9, fontFamily: "Helvetica-BoldOblique", color: NAVY },
  totalsLabelEmphasis: {
    fontSize: 11,
    fontFamily: "Helvetica-BoldOblique",
    color: NAVY,
  },
  totalsValue: { fontSize: 9, color: NAVY },
  totalsValueEmphasis: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },

  // --- footer band ------------------------------------------------------------
  footerBand: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: NAVY,
    paddingVertical: 14,
  },
  footerLink: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textAlign: "center",
    textDecoration: "underline",
  },
});
