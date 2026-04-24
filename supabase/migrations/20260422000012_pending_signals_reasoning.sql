-- Kinvox — Surface AI reasoning on pending_signals cards.
--
-- Until now the scorer's reasoning_snippet only survived on the lead row
-- via leads.metadata (manual mode). For ai_draft mode the signal sits in
-- pending_signals and the card had nothing to display. This column is
-- the canonical home for the snippet on a pending row; the lead
-- metadata remains authoritative once a signal is promoted.

alter table public.pending_signals
  add column if not exists reasoning_snippet text;
