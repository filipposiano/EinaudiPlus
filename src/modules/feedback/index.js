// Superficie pubblica del modulo Feedback.

import { feedbackRepository } from "./infrastructure/feedbackRepository.js";
import { submitFeedback as _submitFeedback } from "./application/submitFeedback.js";
import { adminListFeedback as _adminListFeedback } from "./application/adminListFeedback.js";
import { adminMarkFeedback as _adminMarkFeedback } from "./application/adminMarkFeedback.js";

export { authorize } from "./domain/policy.js";

const deps = { feedbackRepository };

export async function submitFeedback(room, text) {
  return _submitFeedback({ room, text }, deps);
}

export async function adminListFeedback(input) {
  return _adminListFeedback(input, deps);
}

export async function adminMarkFeedback(input) {
  return _adminMarkFeedback(input, deps);
}
