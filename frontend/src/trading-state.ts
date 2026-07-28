import { StatusSnapshot } from './types';

export type ExecutionView = {
  known: boolean;
  paper: boolean;
  oanda: boolean;
  demo: boolean;
  live: boolean;
  ready: boolean;
  blocked: boolean;
  label: string;
};

export function executionView(status: StatusSnapshot | null | undefined): ExecutionView {
  const state = status?.effectiveExecutionState;

  switch (state) {
    case 'PAPER':
      return {
        known: true,
        paper: true,
        oanda: false,
        demo: false,
        live: false,
        ready: true,
        blocked: false,
        label: 'PAPER'
      };
    case 'OANDA_DEMO_READY':
      return {
        known: true,
        paper: false,
        oanda: true,
        demo: true,
        live: false,
        ready: true,
        blocked: false,
        label: 'OANDA DEMO READY'
      };
    case 'OANDA_DEMO_BLOCKED':
      return {
        known: true,
        paper: false,
        oanda: true,
        demo: true,
        live: false,
        ready: false,
        blocked: true,
        label: 'OANDA DEMO BLOCKED'
      };
    case 'OANDA_LIVE_READY':
      return {
        known: true,
        paper: false,
        oanda: true,
        demo: false,
        live: true,
        ready: true,
        blocked: false,
        label: 'OANDA LIVE READY'
      };
    case 'OANDA_LIVE_BLOCKED':
      return {
        known: true,
        paper: false,
        oanda: true,
        demo: false,
        live: true,
        ready: false,
        blocked: true,
        label: 'OANDA LIVE BLOCKED'
      };
    default:
      return {
        known: false,
        paper: false,
        oanda: false,
        demo: false,
        live: false,
        ready: false,
        blocked: false,
        label: 'MODE UNAVAILABLE'
      };
  }
}

export function hasFullFreshCoverage(status: StatusSnapshot | null | undefined) {
  const coverage = status?.priceCoverage;
  const expected = status?.priceExpected;
  return status?.priceFeedStatus === 'CONNECTED' &&
    typeof coverage === 'number' &&
    Number.isFinite(coverage) &&
    typeof expected === 'number' &&
    Number.isFinite(expected) &&
    expected > 0 &&
    coverage >= expected;
}

export function hasVerifiedOandaLedger(status: StatusSnapshot | null | undefined) {
  return executionView(status).oanda && status?.reconciliationStatus === 'VERIFIED';
}
