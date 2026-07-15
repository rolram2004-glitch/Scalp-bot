export type OrderSide = "BUY" | "SELL";

export interface VerifiedOrderRequest {
  oanda: any;
  symbol: string;
  side: OrderSide;
  units: number;
  riskAmount: number;
  rewardAmount: number;
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
}

export type VerifiedOrderResult =
  | { status: "OPENED"; trade: VerifiedOrderTrade }
  | { status: "SKIPPED" | "REJECTED"; reason: string };

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

function roundedUnits(units: number, precision: number) {
  const factor = 10 ** Math.max(0, precision);
  return Math.round(Math.abs(units) * factor) / factor;
}

export async function executeVerifiedMarketOrder(
  request: VerifiedOrderRequest
): Promise<VerifiedOrderResult> {
  const { oanda, symbol, side, riskAmount, rewardAmount } = request;
  const instrument = normalizeOandaSymbol(symbol);

  if (!oanda || typeof oanda.createMarketOrder !== "function") {
    return { status: "REJECTED", reason: "OANDA_CLIENT_UNAVAILABLE" };
  }
  if (side !== "BUY" && side !== "SELL") {
    return { status: "REJECTED", reason: "INVALID_ORDER_SIDE" };
  }
  if (instrument.startsWith("XAU_")) {
    return { status: "SKIPPED", reason: "XAU_LIVE_EXECUTION_NOT_ENABLED" };
  }

  try {
    const [account, openTrades, openPositions, instrumentInfo, pricing] = await Promise.all([
      oanda.getAccount(),
      oanda.getOpenTrades(),
      oanda.getOpenPositions(),
      oanda.getAccountInstrument(instrument),
      oanda.getPricingContext(instrument)
    ]);

    if (!account || !account.currency) {
      return { status: "REJECTED", reason: "OANDA_ACCOUNT_NOT_VERIFIED" };
    }
    if (hasInstrumentExposure(instrument, openTrades, openPositions)) {
      return { status: "SKIPPED", reason: "POSITION_ALREADY_OPEN_ON_OANDA" };
    }
    if (!instrumentInfo) {
      return { status: "REJECTED", reason: "INSTRUMENT_METADATA_UNAVAILABLE" };
    }

    const unitsPrecision = Math.max(0, Number(instrumentInfo.tradeUnitsPrecision || 0));
    const units = roundedUnits(request.units, unitsPrecision);
    const minimumTradeSize = finitePositive(instrumentInfo.minimumTradeSize) || 1;
    if (!Number.isFinite(units) || units < minimumTradeSize) {
      return { status: "REJECTED", reason: "UNITS_BELOW_OANDA_MINIMUM" };
    }

    const price = pricing?.price;
    if (!price || price.tradeable === false || String(price.status || "tradeable").toLowerCase() !== "tradeable") {
      return { status: "REJECTED", reason: "INSTRUMENT_NOT_TRADEABLE" };
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

    const risk = finitePositive(riskAmount);
    const reward = finitePositive(rewardAmount);
    if (!risk || !reward) {
      return { status: "REJECTED", reason: "INVALID_CASH_RISK_CONFIGURATION" };
    }

    const riskDistance = risk / (units * factors.loss);
    const rewardDistance = reward / (units * factors.gain);
    const direction = side === "BUY" ? 1 : -1;
    const displayPrecision = Math.max(0, Number(instrumentInfo.displayPrecision || 5));
    const stopLossNumber = entry - direction * riskDistance;
    const takeProfitNumber = entry + direction * rewardDistance;
    if (stopLossNumber <= 0 || takeProfitNumber <= 0) {
      return { status: "REJECTED", reason: "INVALID_PROTECTIVE_PRICE" };
    }
    const stopLoss = stopLossNumber.toFixed(displayPrecision);
    const takeProfit = takeProfitNumber.toFixed(displayPrecision);

    const response = await oanda.createMarketOrder({
      instrument,
      side,
      units,
      stopLoss,
      takeProfit
    });

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
    if (!orderId || !tradeId) {
      return { status: "REJECTED", reason: "OANDA_FILL_NOT_VERIFIED" };
    }

    const verified = await oanda.getTrade(String(tradeId));
    const verifiedUnits = Number(verified?.currentUnits);
    const expectedSignedUnits = side === "BUY" ? units : -units;
    const tolerance = 0.5 / 10 ** Math.max(0, unitsPrecision);
    const matches =
      verified &&
      String(verified.state).toUpperCase() === "OPEN" &&
      normalizeOandaSymbol(verified.instrument) === instrument &&
      Number.isFinite(verifiedUnits) &&
      Math.abs(verifiedUnits - expectedSignedUnits) < tolerance;
    if (!matches) {
      return { status: "REJECTED", reason: "OANDA_TRADE_VERIFICATION_MISMATCH" };
    }

    const verifiedEntry = finitePositive(verified.price) || entry;
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
        stopLoss: finitePositive(verified?.stopLossOrder?.price) || Number(stopLoss),
        takeProfit: finitePositive(verified?.takeProfitOrder?.price) || Number(takeProfit),
        riskAmount: risk,
        rewardAmount: reward,
        openedAt: verified.openTime || response?.orderFillTransaction?.time || new Date().toISOString(),
        oandaOrderId: String(orderId),
        oandaTradeId: String(tradeId)
      }
    };
  } catch (error) {
    return { status: "REJECTED", reason: safeReason(error) };
  }
}

export const executionTestUtils = {
  hasInstrumentExposure,
  conversionFactors
};
