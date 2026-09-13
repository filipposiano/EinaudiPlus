// Superficie pubblica del modulo Ops — regole ricorrenti generiche
// (valgono per lavanderia e sale insieme, per questo non appartengono a
// nessuno dei due), pulizia, conteggi, panoramica.

import { opsRepository } from "./infrastructure/opsRepository.js";
import { getOverview as _getOverview } from "./application/getOverview.js";
import { listRecurringRules as _listRecurringRules } from "./application/listRecurringRules.js";
import { setRecurringRuleActive as _setRecurringRuleActive } from "./application/setRecurringRuleActive.js";
import { deleteRecurringRule as _deleteRecurringRule } from "./application/deleteRecurringRule.js";
import { applyRecurringRules as _applyRecurringRules } from "./application/applyRecurringRules.js";
import { purgeData as _purgeData } from "./application/purgeData.js";
import { getCounts as _getCounts } from "./application/getCounts.js";

export { authorize } from "./domain/policy.js";

const deps = { opsRepository };

export async function getOverview() {
  return _getOverview({}, deps);
}

export async function listRecurringRules() {
  return _listRecurringRules({}, deps);
}

export async function setRecurringRuleActive(input) {
  return _setRecurringRuleActive(input, deps);
}

export async function deleteRecurringRule(id) {
  return _deleteRecurringRule({ id }, deps);
}

export async function applyRecurringRules(offset) {
  return _applyRecurringRules({ offset }, deps);
}

export async function purgeData(input) {
  return _purgeData(input, deps);
}

export async function getCounts() {
  return _getCounts({}, deps);
}
