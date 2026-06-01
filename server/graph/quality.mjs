export const META_TYPES = new Set(["schema", "query", "runbook", "glossary"]);

export function proofDebtFor(node) {
  const debt = [];
  if (!node.source) debt.push({ severity: "high", label: "missing source" });
  if (!node.confidence || node.confidence.toLowerCase() === "low") debt.push({ severity: "medium", label: `confidence ${node.confidence || "missing"}` });
  if (!node.status) debt.push({ severity: "medium", label: "missing status" });
  if (node.total <= 1 && !META_TYPES.has(node.type) && node.type !== "redirect") debt.push({ severity: "medium", label: "few trusted links" });
  if (Date.now() - Date.parse(node.updatedAt || new Date()) > 45 * 86400000) debt.push({ severity: "low", label: "cooling knowledge" });
  return debt;
}
