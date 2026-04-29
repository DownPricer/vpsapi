export {
  assertSmtpConnection,
  getSmtpConnectionFromEnv,
  resolveMailFrom,
  sendSmtpMessage,
  type SmtpConnection,
} from "./smtp";
export { buildCustomerConfirmation, buildCustomerDecisionEmail, buildOperatorEmail } from "./formatLeadEmail";
export {
  sendCustomerDecisionMail,
  buildDecisionSummaryLines,
  type CustomerDecisionMailResult,
  type CustomerDecisionMailSkippedReason,
} from "./customerDecisionMail";
export {
  sendContactLeadEmail,
  sendDevisLeadEmails,
  sendReservationLeadEmails,
} from "./sendLeadEmails";
