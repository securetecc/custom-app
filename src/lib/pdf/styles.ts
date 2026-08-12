import { StyleSheet } from "@react-pdf/renderer";

export const NAVY = "#071E37";
export const TEAL = "#06E1DC";
export const RULE = "#D6DEE6";
export const MUTED = "#5B6B7C";

/**
 * One shared body-text token, deliberately.
 *
 * The Detailed Work Log and the Service Summary are required to render at
 * matching size -- the failure mode this guards against is one section
 * inheriting a smaller default while the other keeps a larger parent size.
 * Both sections reference `bodyText`; don't inline a fontSize in either.
 */
export const BODY_FONT_SIZE = 9;

export const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56, // room for the fixed page-number footer
    paddingHorizontal: 40,
    fontSize: BODY_FONT_SIZE,
    fontFamily: "Helvetica",
    color: NAVY,
  },

  bodyText: {
    fontSize: BODY_FONT_SIZE,
    lineHeight: 1.45,
    color: NAVY,
  },

  // --- header -------------------------------------------------------------
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { width: 150 },
  orgName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  invoiceMetaBlock: { alignItems: "flex-end" },
  invoiceTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 4,
  },
  metaLine: { fontSize: 9, color: MUTED },

  // --- client billing block ----------------------------------------------
  billBlock: { marginBottom: 16 },
  billLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    letterSpacing: 1,
    marginBottom: 4,
  },
  billName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  billLine: { fontSize: 9, color: NAVY, marginBottom: 1 },

  // --- section headings ---------------------------------------------------
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginTop: 14,
    marginBottom: 6,
  },
  centeredSectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    textAlign: "center",
    marginTop: 14,
    marginBottom: 6,
  },

  // --- tables -------------------------------------------------------------
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    marginBottom: 4,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  colDate: { width: "13%" },
  colDesc: { width: "51%", paddingRight: 6 },
  colHours: { width: "10%", textAlign: "right" },
  colRate: { width: "12%", textAlign: "right" },
  colAmount: { width: "14%", textAlign: "right" },

  chargeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },

  // --- work log -----------------------------------------------------------
  workLogRow: { flexDirection: "row", paddingVertical: 3 },
  workLogDate: { width: "13%" },
  workLogDesc: { width: "87%" },

  // --- totals -------------------------------------------------------------
  totalBlock: {
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: NAVY,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
  },
  totalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginRight: 12,
  },
  totalAmount: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  totalsSubLine: {
    marginTop: 4,
    textAlign: "right",
    fontSize: 9,
    color: MUTED,
  },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: MUTED,
  },
});
