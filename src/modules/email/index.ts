export {
  assertSmtpConnection,
  getSmtpConnectionFromEnv,
  resolveMailFrom,
  sendSmtpMessage,
  type SmtpConnection,
} from "./smtp";
export { buildCustomerConfirmation, buildOperatorEmail } from "./formatLeadEmail";
export {
  sendContactLeadEmail,
  sendDevisLeadEmails,
  sendReservationLeadEmails,
} from "./sendLeadEmails";
