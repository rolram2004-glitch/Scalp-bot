export type OrderSide = "BUY" | "SELL";

export interface VerifiedOrderRequest {
  oanda: any;
  symbol: string;
  side: OrderSide;
  units: number;
  riskAmount: number;
  rewardAmount: number;
  protectionMode?: "ACCOUNT_CASH";
  targetAccountCurrency?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  strategyVariant: "MAIN" | "INVERSE";
  signalId: string;
  signalAt: string;
}

export interface VerifiedOrderTrade {
  source: "OANDA";
  symbol: string;
  side: OrderSide;
  units: number;
  accountCurrency: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  rewardAmount: number;
  openedAt: string;
  oandaOrderId: string;
  oandaTradeId: string;
  strategyVariant: "MAIN" | "INVERSE";
  signalId: string;
  signalAt: string;
  clientTag: string;
}

export type VerifiedOrderResult =
  | { status: "OPENED"; trade: VerifiedOrderTrade }
  | { status: "SKIPPED" | "REJECTED"; reason: string };

const instrumentsInFlight = new Set<string>();
const verifiedSignalIds = new Set<string>();
const PRACTICE_CASH_MAX_UNITS = 1000;
const PRACTICE_CASH_CURRENCY = "CHF";
// A stop loss that sits inside normal bid/ask noise can close the trade before
// price moves in the signal's direction. Require the stop to be at least two
// current spreads from the executable quote. A deliberately close take profit
// is allowed because it cannot trigger on the loss side of the entry.
const ACCOUNT_CASH_MIN_PROTECTION_SPREAD_MULTIPLE = 2;

function practiceCashContract(variant: "MAIN" | "INVERSE") {
  const contracts = {
    MAIN: { risk: 0.1, reward: 0.6 },
    INVERSE: { risk: 0.1, reward: 0.6 }
  } as const;
  return contracts[variant];
}

export function normalizeOandaSymbol(symbol: string) {
  const compact = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 6 ? `${compact.slice(0, 3)}_${compact.slice(3)}` : compact;
}

function finitePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeReason(error: any) {
  const data = error?.response?.data || {};
  const code = data.errorCode || error?.code;
  if (code) return String(code).slice(0, 120);
  const message = data.errorMessage || error?.message;
  if (!message) return "OANDA_REQUEST_FAILED";
  return String(message)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .slice(0, 180);
}

function quoteCurrency(instrument: string) {
  return normalizeOandaSymbol(instrument).split("_")[1] || "";
}

function conversionFactors(
  price: any,
  homeConversions: any[],
  instrument: string,
  accountCurrency: string
) {
  const quote = quoteCurrency(instrument);
  if (quote && quote === String(accountCurrency || "").toUpperCase()) {
    return { loss: 1, gain: 1 };
  }

  const direct = price?.quoteHomeConversionFactors;
  const directLoss = finitePositive(direct?.negativeUnits);
  const directGain = finitePositive(direct?.positiveUnits);
  if (directLoss && directGain) {
    return { loss: directLoss, gain: directGain };
  }

  const home = Array.isArray(homeConversions)
    ? homeConversions.find((item) => String(item?.currency || "").toUpperCase() === quote)
    : null;
  const loss = finitePositive(home?.accountLoss);
  const gain = finitePositive(home?.accountGain);
  return loss && gain ? { loss, gain } : null;
}

function executablePrice(price: any, side: OrderSide) {
  const preferred = side === "BUY" ? price?.asks?.[0]?.price : price?.bids?.[0]?.price;
  return finitePositive(preferred) || finitePositive(side === "BUY" ? price?.closeoutAsk : price?.closeoutBid);
}

function executableSpread(price: any) {
  const ask = finitePositive(price?.asks?.[0]?.price) || finitePositive(price?.closeoutAsk);
  const bid = finitePositive(price?.bids?.[0]?.price) || finitePositive(price?.closeoutBid);
  if (!ask || !bid || ask < bid) return null;
  return ask - bid;
}

function fillConversionFactors(fillTransaction: any, fallback: { loss: number; gain: number }) {
  const modern = fillTransaction?.homeConversionFactors;
  const modernLoss = finitePositive(modern?.lossQuoteHome?.factor);
  const modernGain = finitePositive(modern?.gainQuoteHome?.factor);
  if (modernLoss && modernGain) return { loss: modernLoss, gain: modernGain };

  const legacyLoss = finitePositive(fillTransaction?.lossQuoteHomeConversionFactor);
  const legacyGain = finitePositive(fillTransaction?.gainQuoteHomeConversionFactor);
  if (legacyLoss && legacyGain) return { loss: legacyLoss, gain: legacyGain };

  return fallback;
}

function accountCashProtectionPlan(
  entry: number,
  side: OrderSide,
  units: number,
  factors: { loss: number; gain: number },
  displayPrecision: number,
  riskTarget: number,
  rewardTarget: number
) {
  const direction = side === "BUY" ? 1 : -1;
  const riskDistance = riskTarget / (units * factors.loss);
  const rewardDistance = rewardTarget / (units * factors.gain);
  const stopLoss = (entry - direction * riskDistance).toFixed(displayPrecision);
  const takeProfit = (entry + direction * rewardDistance).toFixed(displayPrecision);
  const stopLossNumber = Number(stopLoss);
  const takeProfitNumber = Number(takeProfit);
  if (!finitePositive(stopLossNumber) || !finitePositive(takeProfitNumber) ||
      (entry - stopLossNumber) * direction <= 0 ||
      (takeProfitNumber - entry) * direction <= 0) {
    return null;
  }

  const riskAmount = Math.abs(entry - stopLossNumber) * units * factors.loss;
  const rewardAmount = Math.abs(takeProfitNumber - entry) * units * factors.gain;
  const priceHalfTick = 0.5 * 10 ** (-displayPrecision);
  const riskTolerance = priceHalfTick * units * factors.loss + 1e-10;
  const rewardTolerance = priceHalfTick * units * factors.gain + 1e-10;
  if (Math.abs(riskAmount - riskTarget) > riskTolerance ||
      Math.abs(rewardAmount - rewardTarget) > rewardTolerance) {
    return null;
  }

  return {
    stopLoss,
    takeProfit,
    stopLossNumber,
    takeProfitNumber,
    riskAmount,
    rewardAmount
  };
}

function hasInstrumentExposure(instrument: string, trades: any[], positions: any[]) {
  const normalized = normalizeOandaSymbol(instrument);
  const openTrade = (Array.isArray(trades) ? trades : []).some(
    (trade) => normalizeOandaSymbol(trade?.instrument) === normalized && String(trade?.state || "OPEN") === "OPEN"
  );
  const openPosition = (Array.isArray(positions) ? positions : []).some((position) => {
    if (normalizeOandaSymbol(position?.instrument) !== normalized) return false;
    return Number(position?.long?.units || 0) !== 0 || Number(position?.short?.units || 0) !== 0;
  });
  return openTrade || openPosition;
}

const PROTECTIVE_PENDING_ORDER_TYPES = new Set([
  "TAKE_PROFIT",
  "STOP_LOSS",
  "TRAILING_STOP_LOSS",
  "GUARANTEED_STOP_LOSS"
]);

function pendingOrderDataComplete(order: any) {
  const type = String(order?.type || "").trim().toUpperCase();
  if (!order?.id || !type) return false;

  // OANDA dependent TP/SL orders are attached to a trade and legitimately do
  // not include `instrument`. Entry-capable pending orders must include it so
  // the one-position-per-symbol gate can compare them safely.
  if (PROTECTIVE_PENDING_ORDER_TYPES.has(type)) return true;
  return Boolean(order?.instrument);
}

function hasPendingEntryOrder(instrument: string, orders: any[]) {
  const normalized = normalizeOandaSymbol(instrument);
  if (!Array.isArray(orders)) return true;
  return orders.some((order) => {
    if (normalizeOandaSymbol(order?.instrument) !== normalized) return false;
    const state = String(order?.state || "PENDING").toUpperCase();
    if (state !== "PENDING") return false;
    const type = String(order?.type || "").toUpperCase();
    return !PROTECTIVE_PENDING_ORDER_TYPES.has(type);
  });
}

function strictPrecision(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 12 ? parsed : null;
}

function signedPositionUnits(instrument: string, positions: any[]) {
  if (!Array.isArray(positions)) return null;
  const normalized = normalizeOandaSymbol(instrument);
  const position = positions.find(
    (item) => normalizeOandaSymbol(item?.instrument) === normalized
  );
  if (!position) return 0;
  const longUnits = Number(position?.long?.units);
  const shortUnits = Number(position?.short?.units);
  if (!Number.isFinite(longUnits) || !Number.isFinite(shortUnits)) return null;
  return longUnits + shortUnits;
}

function matchingTaggedOpenTrades(
  instrument: string,
  trades: any[],
  expectedClientTag: string,
  expectedSignedUnits: number,
  tolerance: number
) {
  if (!Array.isArray(trades)) return [];
  return trades.filter((trade: any) => {
    const candidateUnits = Number(trade?.currentUnits);
    return Boolean(trade?.id) &&
      String(trade?.state || "OPEN").toUpperCase() === "OPEN" &&
      normalizeOandaSymbol(trade?.instrument) === instrument &&
      Number.isFinite(candidateUnits) &&
      Math.abs(candidateUnits - expectedSignedUnits) < tolerance &&
      String(trade?.clientExtensions?.tag || "") === expectedClientTag;
  });
}

function roundedUnits(units: number, precision: number) {
  const factor = 10 ** Math.max(0, precision);
  return Math.round(Math.abs(units) * factor) / factor;
}

function roundedUnitsDown(units: number, precision: number) {
  const factor = 10 ** Math.max(0, precision);
  return Math.floor((Math.abs(units) + Number.EPSILON) * factor) / factor;
}

function adaptivePracticeCashUnits(
  requestedUnits: number,
  minimumTradeSize: number,
  unitsPrecision: number,
  riskTarget: number,
  lossFactor: number,
  spread: number
) {
  if (!Number.isFinite(spread) || spread < 0 || !finitePositive(lossFactor)) return null;
  if (spread === 0) return roundedUnits(requestedUnits, unitsPrecision);
  const maximumSafeUnits = riskTarget /
    (spread * ACCOUNT_CASH_MIN_PROTECTION_SPREAD_MULTIPLE * lossFactor);
  const units = roundedUnitsDown(Math.min(requestedUnits, maximumSafeUnits), unitsPrecision);
  return units >= minimumTradeSize ? units : null;
}

function clientTag(variant: "MAIN" | "INVERSE", signalId?: string) {
  const suffix = String(signalId || "UNTRACKED").replace(/[^A-Za-z0-9._-]/g, "-");
  return `GEMMO-${variant}-${suffix}`.slice(0, 128);
}

async function closeUnverifiedExposure(oanda: any, tradeId: string, reason: string): Promise<VerifiedOrderResult> {
  const baseReason = String(reason || "OANDA_POST_FILL_VERIFICATION_FAILED")
    .replace(/[^A-Z0-9_]/gi, "_")
    .slice(0, 120);
  if (!tradeId || typeof oanda?.closeTrade !== "function" || typeof oanda?.getTrade !== "function") {
    return { status: "REJECTED", reason: `${baseReason}_EMERGENCY_CLOSE_NOT_VERIFIED` };
  }

  try {
    await oanda.closeTrade(String(tradeId), "ALL");
  } catch (_error) {
    // A close rejection can also mean the trade was already closed. The
    // authoritative re-read below decides whether exposure still exists.
  }

  try {
    const closed = await oanda.getTrade(String(tradeId));
    if (String(closed?.state || "").toUpperCase() === "CLOSED") {
      return { status: "REJECTED", reason: `${baseReason}_EXPOSURE_CLOSED` };
    }
  } catch (_error) {
    // Fall through to the explicit critical state. No local trade is created.
  }

  return { status: "REJECTED", reason: `${baseReason}_EMERGENCY_CLOSE_NOT_VERIFIED` };
}

export async function executeVerifiedMarketOrder(
  request: VerifiedOrderRequest
): Promise<VerifiedOrderResult> {
  const { oanda, symbol, side, riskAmount, rewardAmount } = request;
  const instrument = normalizeOandaSymbol(symbol);
  const strategyVariant = request.strategyVariant;
  const protectionMode = request.protectionMode;
  const accountCashProtection = protectionMode === "ACCOUNT_CASH";
  const cashContract = practiceCashContract(strategyVariant);
  const signalId = String(request.signalId || "").trim();
  const signalAt = String(request.signalAt || "").trim();

  if (!oanda || typeof oanda.createMarketOrder !== "function") {
    return { status: "REJECTED", reason: "OANDA_CLIENT_UNAVAILABLE" };
  }
  if (side !== "BUY" && side !== "SELL") {
    return { status: "REJECTED", reason: "INVALID_ORDER_SIDE" };
  }
  if (strategyVariant !== "MAIN" && strategyVariant !== "INVERSE") {
    return { status: "REJECTED", reason: "INVALID_STRATEGY_VARIANT" };
  }
  if (protectionMode !== undefined && protectionMode !== "ACCOUNT_CASH") {
    return { status: "REJECTED", reason: "INVALID_PROTECTION_MODE" };
  }
  if (accountCashProtection &&
      (request.stopLossPrice !== undefined || request.takeProfitPrice !== undefined)) {
    return { status: "REJECTED", reason: "ACCOUNT_CASH_EXPLICIT_LEVELS_NOT_ALLOWED" };
  }
  if (accountCashProtection &&
      String(request.targetAccountCurrency || "").trim().toUpperCase() !== PRACTICE_CASH_CURRENCY) {
    return { status: "REJECTED", reason: "ACCOUNT_TARGET_CURRENCY_MISMATCH" };
  }
  if (accountCashProtection && Math.abs(Number(request.units)) !== PRACTICE_CASH_MAX_UNITS) {
    return { status: "REJECTED", reason: "ACCOUNT_CASH_UNITS_MUST_EQUAL_1000" };
  }
  if (accountCashProtection &&
      (Math.abs(Number(riskAmount) - cashContract.risk) > 1e-12 ||
       Math.abs(Number(rewardAmount) - cashContract.reward) > 1e-12)) {
    return { status: "REJECTED", reason: "ACCOUNT_CASH_TARGETS_INVALID" };
  }
  if (accountCashProtection && typeof oanda.replaceTradeDependentOrders !== "function") {
    return { status: "REJECTED", reason: "OANDA_DEPENDENT_ORDER_REPLACEMENT_UNAVAILABLE" };
  }
  if (accountCashProtection && typeof oanda.assertAccountCashExecutionConfigured !== "function") {
    return { status: "REJECTED", reason: "OANDA_ACCOUNT_CASH_EXECUTION_GUARD_UNAVAILABLE" };
  }
  if (!signalId) {
    return { status: "REJECTED", reason: "SIGNAL_ID_REQUIRED" };
  }
  if (!signalAt || !Number.isFinite(Date.parse(signalAt))) {
    return { status: "REJECTED", reason: "SIGNAL_TIMESTAMP_REQUIRED" };
  }
  if (instrument.startsWith("XAU_")) {
    return { status: "SKIPPED", reason: "XAU_LIVE_EXECUTION_NOT_ENABLED" };
  }
  if (signalId && verifiedSignalIds.has(signalId)) {
    return { status: "SKIPPED", reason: "SIGNAL_ALREADY_EXECUTED" };
  }
  if (instrumentsInFlight.has(instrument)) {
    return { status: "SKIPPED", reason: "ORDER_SUBMISSION_ALREADY_IN_PROGRESS" };
  }

  if (accountCashProtection) {
    try {
      oanda.assertAccountCashExecutionConfigured();
    } catch (error) {
      return { status: "REJECTED", reason: safeReason(error) };
    }
  }

  instrumentsInFlight.add(instrument);
  let filledTradeId: string | undefined;

  try {
    const [account, openTrades, openPositions, pendingOrders, instrumentInfo, pricing] = await Promise.all([
      oanda.getAccount(),
      oanda.getOpenTrades(),
      oanda.getOpenPositions(),
      oanda.getPendingOrders(),
      oanda.getAccountInstrument(instrument),
      oanda.getPricingContext(instrument)
    ]);

    if (!account || !account.currency) {
      return { status: "REJECTED", reason: "OANDA_ACCOUNT_NOT_VERIFIED" };
    }
    if (accountCashProtection &&
        String(account.currency).trim().toUpperCase() !== PRACTICE_CASH_CURRENCY) {
      return { status: "REJECTED", reason: "ACCOUNT_TARGET_CURRENCY_MISMATCH" };
    }
    if (!Array.isArray(openTrades) || !Array.isArray(openPositions) || !Array.isArray(pendingOrders)) {
      return { status: "REJECTED", reason: "OANDA_PREFLIGHT_RECONCILIATION_UNAVAILABLE" };
    }
    if (hasInstrumentExposure(instrument, openTrades, openPositions)) {
      return { status: "SKIPPED", reason: "POSITION_ALREADY_OPEN_ON_OANDA" };
    }
    if (pendingOrders.some((order: any) => !pendingOrderDataComplete(order))) {
      return { status: "REJECTED", reason: "OANDA_PENDING_ORDER_DATA_INCOMPLETE" };
    }
    if (hasPendingEntryOrder(instrument, pendingOrders)) {
      return { status: "SKIPPED", reason: "PENDING_ENTRY_ORDER_ALREADY_EXISTS_ON_OANDA" };
    }
    if (!instrumentInfo) {
      return { status: "REJECTED", reason: "INSTRUMENT_METADATA_UNAVAILABLE" };
    }

    const unitsPrecision = strictPrecision(instrumentInfo.tradeUnitsPrecision);
    const displayPrecision = strictPrecision(instrumentInfo.displayPrecision);
    const minimumTradeSize = finitePositive(instrumentInfo.minimumTradeSize);
    if (unitsPrecision === null || displayPrecision === null || minimumTradeSize === null) {
      return { status: "REJECTED", reason: "INSTRUMENT_METADATA_INCOMPLETE" };
    }
    let units = roundedUnits(request.units, unitsPrecision);
    if (!Number.isFinite(units) || units < minimumTradeSize) {
      return { status: "REJECTED", reason: "UNITS_BELOW_OANDA_MINIMUM" };
    }
    if (accountCashProtection && units !== PRACTICE_CASH_MAX_UNITS) {
      return { status: "REJECTED", reason: "ACCOUNT_CASH_UNITS_MUST_EQUAL_1000" };
    }

    const price = pricing?.price;
    if (!price || price.tradeable !== true || String(price.status || "").toLowerCase() !== "tradeable") {
      return { status: "REJECTED", reason: "INSTRUMENT_NOT_TRADEABLE" };
    }
    const priceTime = Date.parse(String(price.time || ""));
    const priceAge = Date.now() - priceTime;
    if (!Number.isFinite(priceTime) || priceAge < -5000 || priceAge > 30000) {
      return { status: "REJECTED", reason: "OANDA_PRICING_SNAPSHOT_STALE" };
    }
    const entry = executablePrice(price, side);
    if (!entry) {
      return { status: "REJECTED", reason: "EXECUTABLE_PRICE_UNAVAILABLE" };
    }

    const factors = conversionFactors(
      price,
      pricing?.homeConversions || [],
      instrument,
      account.currency
    );
    if (!factors) {
      return { status: "REJECTED", reason: "QUOTE_TO_ACCOUNT_CONVERSION_UNAVAILABLE" };
    }

    const executionSpread = accountCashProtection ? executableSpread(price) : null;
    if (accountCashProtection && executionSpread === null) {
      return { status: "REJECTED", reason: "OANDA_BID_ASK_SPREAD_UNAVAILABLE" };
    }
    if (accountCashProtection) {
      const adaptiveUnits = adaptivePracticeCashUnits(
        units,
        minimumTradeSize,
        unitsPrecision,
        cashContract.risk,
        factors.loss,
        executionSpread as number
      );
      if (!adaptiveUnits) {
        return { status: "SKIPPED", reason: "ACCOUNT_CASH_SPREAD_TOO_WIDE_FOR_MINIMUM_UNITS" };
      }
      units = adaptiveUnits;
    }

    const direction = side === "BUY" ? 1 : -1;
    const explicitProtectionRequested = request.stopLossPrice !== undefined || request.takeProfitPrice !== undefined;
    const requestedStopLoss = finitePositive(request.stopLossPrice);
    const requestedTakeProfit = finitePositive(request.takeProfitPrice);
    if (explicitProtectionRequested && (!requestedStopLoss || !requestedTakeProfit)) {
      return { status: "REJECTED", reason: "EXPLICIT_PROTECTIVE_LEVELS_INCOMPLETE" };
    }

    let risk: number;
    let reward: number;
    let stopLossNumber: number;
    let takeProfitNumber: number;
    if (accountCashProtection) {
      const initialCashPlan = accountCashProtectionPlan(
        entry,
        side,
        units,
        factors,
        displayPrecision,
        cashContract.risk,
        cashContract.reward
      );
      if (!initialCashPlan) {
        return { status: "REJECTED", reason: "PROTECTIVE_LEVELS_INVALID_AFTER_ROUNDING" };
      }
      stopLossNumber = initialCashPlan.stopLossNumber;
      takeProfitNumber = initialCashPlan.takeProfitNumber;
      risk = initialCashPlan.riskAmount;
      reward = initialCashPlan.rewardAmount;
    } else if (explicitProtectionRequested) {
      stopLossNumber = requestedStopLoss as number;
      takeProfitNumber = requestedTakeProfit as number;
      const directional = (entry - stopLossNumber) * direction > 0 &&
        (takeProfitNumber - entry) * direction > 0;
      if (!directional) {
        return { status: "REJECTED", reason: "EXPLICIT_PROTECTIVE_LEVELS_NOT_DIRECTIONAL" };
      }
      risk = Math.abs(entry - stopLossNumber) * units * factors.loss;
      reward = Math.abs(takeProfitNumber - entry) * units * factors.gain;
      if (!finitePositive(risk) || !finitePositive(reward)) {
        return { status: "REJECTED", reason: "EXPLICIT_PROTECTIVE_RISK_INVALID" };
      }
    } else {
      const configuredRisk = finitePositive(riskAmount);
      const configuredReward = finitePositive(rewardAmount);
      if (!configuredRisk || !configuredReward) {
        return { status: "REJECTED", reason: "INVALID_CASH_RISK_CONFIGURATION" };
      }
      risk = configuredRisk;
      reward = configuredReward;
      const riskDistance = risk / (units * factors.loss);
      const rewardDistance = reward / (units * factors.gain);
      stopLossNumber = entry - direction * riskDistance;
      takeProfitNumber = entry + direction * rewardDistance;
    }
    if (stopLossNumber <= 0 || takeProfitNumber <= 0) {
      return { status: "REJECTED", reason: "INVALID_PROTECTIVE_PRICE" };
    }
    let stopLoss = stopLossNumber.toFixed(displayPrecision);
    let takeProfit = takeProfitNumber.toFixed(displayPrecision);
    const roundedStopLoss = Number(stopLoss);
    const roundedTakeProfit = Number(takeProfit);
    if ((entry - roundedStopLoss) * direction <= 0 || (roundedTakeProfit - entry) * direction <= 0) {
      return { status: "REJECTED", reason: "PROTECTIVE_LEVELS_INVALID_AFTER_ROUNDING" };
    }
    if (accountCashProtection) {
      const stopLossDistance = Math.abs(entry - roundedStopLoss);
      const priceHalfTick = 0.5 * 10 ** (-displayPrecision);
      const minimumDistance = (executionSpread as number) * ACCOUNT_CASH_MIN_PROTECTION_SPREAD_MULTIPLE;
      if (stopLossDistance + priceHalfTick < minimumDistance) {
        return { status: "SKIPPED", reason: "ACCOUNT_CASH_PROTECTION_TOO_CLOSE_TO_SPREAD" };
      }
    }

    const expectedClientTag = clientTag(strategyVariant, signalId);
    const expectedSignedUnits = side === "BUY" ? units : -units;
    const tolerance = 0.5 / 10 ** Math.max(0, unitsPrecision);
    let response: any;
    try {
      response = await oanda.createMarketOrder({
        instrument,
        side,
        units,
        stopLoss,
        takeProfit,
        clientTag: expectedClientTag,
        strategyVariant
      });
    } catch (error) {
      try {
        const [tradesAfterSubmit, positionsAfterSubmit] = await Promise.all([
          oanda.getOpenTrades(),
          oanda.getOpenPositions()
        ]);
        const candidates = matchingTaggedOpenTrades(
          instrument,
          tradesAfterSubmit,
          expectedClientTag,
          expectedSignedUnits,
          tolerance
        );
        if (candidates.length === 1) {
          return closeUnverifiedExposure(
            oanda,
            String(candidates[0].id),
            "OANDA_ORDER_SUBMISSION_OUTCOME_NOT_VERIFIED"
          );
        }
        const positionUnits = signedPositionUnits(instrument, positionsAfterSubmit);
        if (candidates.length === 0 && positionUnits === 0) {
          return { status: "REJECTED", reason: safeReason(error) };
        }
      } catch (_reconciliationError) {
        // The POST result is ambiguous until OANDA can be reconciled again.
      }
      return {
        status: "REJECTED",
        reason: "OANDA_ORDER_SUBMISSION_OUTCOME_NOT_VERIFIED"
      };
    }

    if (response?.orderRejectTransaction) {
      return {
        status: "REJECTED",
        reason: String(response.orderRejectTransaction.rejectReason || "ORDER_REJECTED").slice(0, 120)
      };
    }
    if (response?.orderCancelTransaction) {
      return {
        status: "REJECTED",
        reason: String(response.orderCancelTransaction.reason || "ORDER_CANCELLED").slice(0, 120)
      };
    }

    const orderId = response?.orderCreateTransaction?.id;
    const tradeId = response?.orderFillTransaction?.tradeOpened?.tradeID;
    if (!tradeId) {
      try {
        const [tradesAfterFill, positionsAfterFill] = await Promise.all([
          oanda.getOpenTrades(),
          oanda.getOpenPositions()
        ]);
        if (!Array.isArray(tradesAfterFill) || !Array.isArray(positionsAfterFill)) {
          throw new Error("OANDA_POST_FILL_RECONCILIATION_UNAVAILABLE");
        }
        const candidates = matchingTaggedOpenTrades(
          instrument,
          tradesAfterFill,
          expectedClientTag,
          expectedSignedUnits,
          tolerance
        );
        if (candidates.length === 1) {
          return closeUnverifiedExposure(
            oanda,
            String(candidates[0].id),
            "OANDA_FILL_TRADE_ID_NOT_VERIFIED"
          );
        }
        const positionUnits = signedPositionUnits(instrument, positionsAfterFill);
        if (candidates.length === 0 && positionUnits === 0) {
          return { status: "REJECTED", reason: "OANDA_FILL_NOT_VERIFIED" };
        }
      } catch (_error) {
        // The outcome of a submitted market order is ambiguous if OANDA cannot
        // be reconciled immediately. Never create a local trade in this state.
      }
      return {
        status: "REJECTED",
        reason: "OANDA_FILL_NOT_VERIFIED_EMERGENCY_CLOSE_NOT_VERIFIED"
      };
    }
    filledTradeId = String(tradeId);
    if (!orderId) {
      return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_ORDER_ID_NOT_VERIFIED");
    }

    const [initiallyVerified, positionsAfterFill] = await Promise.all([
      oanda.getTrade(filledTradeId),
      oanda.getOpenPositions()
    ]);
    let verified = initiallyVerified;
    const verifiedUnits = Number(verified?.currentUnits);
    const positionUnits = signedPositionUnits(instrument, positionsAfterFill);
    const tradeMatches =
      verified &&
      String(verified.state).toUpperCase() === "OPEN" &&
      normalizeOandaSymbol(verified.instrument) === instrument &&
      Number.isFinite(verifiedUnits) &&
      Math.abs(verifiedUnits - expectedSignedUnits) < tolerance &&
      String(verified?.clientExtensions?.tag || "") === expectedClientTag;
    if (!tradeMatches) {
      return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_TRADE_VERIFICATION_MISMATCH");
    }
    if (positionUnits === null || Math.abs(positionUnits - expectedSignedUnits) >= tolerance) {
      return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_POSITION_VERIFICATION_MISMATCH");
    }

    const verifiedEntry = finitePositive(verified.price);
    const verifiedOpenedAt = String(verified?.openTime || response?.orderFillTransaction?.time || "");
    if (!verifiedEntry || !Number.isFinite(Date.parse(verifiedOpenedAt))) {
      return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_TRADE_DETAILS_INCOMPLETE");
    }

    let finalFactors = factors;
    if (accountCashProtection) {
      const initialStopLoss = finitePositive(verified?.stopLossOrder?.price);
      const initialTakeProfit = finitePositive(verified?.takeProfitOrder?.price);
      const initialProtectionDirectional = initialStopLoss !== null && initialTakeProfit !== null &&
        (verifiedEntry - initialStopLoss) * direction > 0 &&
        (initialTakeProfit - verifiedEntry) * direction > 0;
      const initialProtectiveOrdersVerified =
        Boolean(verified?.stopLossOrder?.id) &&
        Boolean(verified?.takeProfitOrder?.id) &&
        String(verified?.stopLossOrder?.state || "").toUpperCase() === "PENDING" &&
        String(verified?.takeProfitOrder?.state || "").toUpperCase() === "PENDING" &&
        initialProtectionDirectional &&
        initialStopLoss === Number(stopLoss) &&
        initialTakeProfit === Number(takeProfit);
      if (!initialProtectiveOrdersVerified) {
        return closeUnverifiedExposure(
          oanda,
          filledTradeId,
          "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED"
        );
      }

      finalFactors = fillConversionFactors(response?.orderFillTransaction, factors);
      const fillCashPlan = accountCashProtectionPlan(
        verifiedEntry,
        side,
        units,
        finalFactors,
        displayPrecision,
        cashContract.risk,
        cashContract.reward
      );
      if (!fillCashPlan) {
        return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED");
      }
      stopLoss = fillCashPlan.stopLoss;
      takeProfit = fillCashPlan.takeProfit;
      risk = fillCashPlan.riskAmount;
      reward = fillCashPlan.rewardAmount;

      try {
        await oanda.replaceTradeDependentOrders({
          tradeId: filledTradeId,
          stopLoss,
          takeProfit,
          strategyVariant
        });
        verified = await oanda.getTrade(filledTradeId);
      } catch (_error) {
        return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED");
      }

      const postReplaceUnits = Number(verified?.currentUnits);
      const postReplaceTradeMatches =
        verified &&
        String(verified.state).toUpperCase() === "OPEN" &&
        normalizeOandaSymbol(verified.instrument) === instrument &&
        Number.isFinite(postReplaceUnits) &&
        Math.abs(postReplaceUnits - expectedSignedUnits) < tolerance &&
        String(verified?.clientExtensions?.tag || "") === expectedClientTag &&
        finitePositive(verified.price) === verifiedEntry;
      if (!postReplaceTradeMatches) {
        return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED");
      }
    }

    const verifiedStopLoss = finitePositive(verified?.stopLossOrder?.price);
    const verifiedTakeProfit = finitePositive(verified?.takeProfitOrder?.price);
    const priceTolerance = 0.5 / 10 ** displayPrecision;
    const verifiedProtectionDirectional = verifiedStopLoss !== null && verifiedTakeProfit !== null &&
      (verifiedEntry - verifiedStopLoss) * direction > 0 &&
      (verifiedTakeProfit - verifiedEntry) * direction > 0;
    const protectiveOrdersVerified =
      Boolean(verified?.stopLossOrder?.id) &&
      Boolean(verified?.takeProfitOrder?.id) &&
      String(verified?.stopLossOrder?.state || "").toUpperCase() === "PENDING" &&
      String(verified?.takeProfitOrder?.state || "").toUpperCase() === "PENDING" &&
      verifiedStopLoss !== null &&
      verifiedTakeProfit !== null &&
      verifiedProtectionDirectional &&
      Math.abs(verifiedStopLoss - Number(stopLoss)) <= priceTolerance &&
      Math.abs(verifiedTakeProfit - Number(takeProfit)) <= priceTolerance;
    if (!protectiveOrdersVerified) {
      return closeUnverifiedExposure(
        oanda,
        filledTradeId,
        accountCashProtection
          ? "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED"
          : "OANDA_PROTECTIVE_ORDERS_NOT_VERIFIED"
      );
    }

    if (accountCashProtection) {
      const verifiedRisk = Math.abs(verifiedEntry - verifiedStopLoss) * units * finalFactors.loss;
      const verifiedReward = Math.abs(verifiedTakeProfit - verifiedEntry) * units * finalFactors.gain;
      const priceHalfTick = 0.5 * 10 ** (-displayPrecision);
      const riskTolerance = priceHalfTick * units * finalFactors.loss + 1e-10;
      const rewardTolerance = priceHalfTick * units * finalFactors.gain + 1e-10;
      if (Math.abs(verifiedRisk - cashContract.risk) > riskTolerance ||
          Math.abs(verifiedReward - cashContract.reward) > rewardTolerance) {
        return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_CASH_PROTECTIVE_ORDERS_NOT_VERIFIED");
      }
      risk = verifiedRisk;
      reward = verifiedReward;
    }
    verifiedSignalIds.add(signalId);
    if (verifiedSignalIds.size > 10000) {
      const oldest = verifiedSignalIds.values().next().value;
      if (oldest) verifiedSignalIds.delete(oldest);
    }
    return {
      status: "OPENED",
      trade: {
        source: "OANDA",
        symbol: instrument.replace("_", ""),
        side,
        units,
        accountCurrency: String(account.currency).toUpperCase(),
        entryPrice: verifiedEntry,
        currentPrice: verifiedEntry,
        stopLoss: verifiedStopLoss,
        takeProfit: verifiedTakeProfit,
        riskAmount: risk,
        rewardAmount: reward,
        openedAt: verifiedOpenedAt,
        oandaOrderId: String(orderId),
        oandaTradeId: filledTradeId,
        strategyVariant,
        signalId,
        signalAt,
        clientTag: expectedClientTag
      }
    };
  } catch (error) {
    if (filledTradeId) {
      return closeUnverifiedExposure(oanda, filledTradeId, "OANDA_POST_FILL_VERIFICATION_FAILED");
    }
    return { status: "REJECTED", reason: safeReason(error) };
  } finally {
    instrumentsInFlight.delete(instrument);
  }
}

export const executionTestUtils = {
  hasInstrumentExposure,
  conversionFactors,
  fillConversionFactors,
  accountCashProtectionPlan,
  adaptivePracticeCashUnits,
  executableSpread,
  clientTag
};
