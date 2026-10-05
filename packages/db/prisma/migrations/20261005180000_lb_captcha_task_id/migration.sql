-- Solver task id on a captcha event. Nullable so existing rows stay valid.
-- The column never stores a token, an answer or an image.
ALTER TABLE "lb_captcha_events" ADD COLUMN "taskId" TEXT;
