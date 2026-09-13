// Superficie pubblica del modulo Conference Room.

import { conferenceRepository } from "./infrastructure/conferenceRepository.js";
import { getAgenda as _getAgenda } from "./application/getAgenda.js";
import { listRules as _listRules } from "./application/listRules.js";
import { addRule as _addRule } from "./application/addRule.js";
import { updateRule as _updateRule } from "./application/updateRule.js";
import { skipOccurrence as _skipOccurrence } from "./application/skipOccurrence.js";
import { moveOccurrence as _moveOccurrence } from "./application/moveOccurrence.js";
import { resetOccurrence as _resetOccurrence } from "./application/resetOccurrence.js";
import { deleteRule as _deleteRule } from "./application/deleteRule.js";

export { authorize } from "./domain/policy.js";

const deps = { conferenceRepository };

export async function getAgenda(giorni) {
  return _getAgenda({ giorni }, deps);
}

export async function listRules() {
  return _listRules({}, deps);
}

export async function addRule(input) {
  return _addRule(input, deps);
}

export async function updateRule(input) {
  return _updateRule(input, deps);
}

export async function skipOccurrence(input) {
  return _skipOccurrence(input, deps);
}

export async function moveOccurrence(input) {
  return _moveOccurrence(input, deps);
}

export async function resetOccurrence(input) {
  return _resetOccurrence(input, deps);
}

export async function deleteRule(id) {
  return _deleteRule({ id }, deps);
}
