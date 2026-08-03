import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildTimeEntryPrompt, type ServiceTypeForPrompt } from "./time-entry-prompt";

export type RawParsedTimeEntry = {
  clientShortName: string;
  durationHours: number;
  description: string;
  date: string;
  billableStatus: "Billable" | "Non-Billable" | "Residual";
  billingRate: number | null;
};

export async function parseTimeEntryWithGemini({
  orgName,
  rawInput,
  clientShortNames,
  serviceTypes,
}: {
  orgName: string;
  rawInput: string;
  clientShortNames: string[];
  serviceTypes: ServiceTypeForPrompt[];
}): Promise<RawParsedTimeEntry> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = buildTimeEntryPrompt({ orgName, rawInput, clientShortNames, serviceTypes });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The AI parser returned something that wasn't valid JSON. Try rephrasing.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("clientShortName" in parsed) ||
    !("durationHours" in parsed) ||
    !("description" in parsed)
  ) {
    throw new Error("The AI parser response was missing required fields.");
  }

  return parsed as RawParsedTimeEntry;
}
