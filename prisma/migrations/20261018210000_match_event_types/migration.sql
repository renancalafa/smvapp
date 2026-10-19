-- Novos tipos de evento do Modo Pelada (cartões, trave, desarme).
-- Não altera Migration 001; só amplia o enum MatchEventType.
-- Cartões são apenas registros — sem suspensão automática nesta fase.

ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'YELLOW_CARD';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'BLUE_CARD';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'RED_CARD';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'HIT_WOODWORK';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'TACKLE';
