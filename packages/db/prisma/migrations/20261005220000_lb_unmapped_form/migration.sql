-- Generic form mapping can park a host when it will not guess a submit control.
ALTER TABLE "lb_operator_tickets" DROP CONSTRAINT "lb_operator_tickets_reason_check";
ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_reason_check" CHECK ("reason" IN ('captcha_unsolved', 'two_factor', 'missing_password', 'admin_approval', 'unknown_page_state', 'unmapped_form'));
