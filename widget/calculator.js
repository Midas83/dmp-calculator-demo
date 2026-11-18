/*
 * DMP savings math. Pure functions, no DOM.
 * Works in the browser (window.DMPCalc) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DMPCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Longest payoff we simulate. Anything longer shows as "50+ years".
  var MAX_MONTHS = 600;

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * Current path when the user does not give a payment:
   * the typical card minimum, recalculated every month.
   * minimum = interest + pctOfBalance% of balance, never below floor.
   */
  function minimumPaymentPath(balance, aprPct, pctOfBalance, floor) {
    var r = aprPct / 100 / 12;
    var bal = balance, months = 0, interestTotal = 0, paidTotal = 0;
    var firstPayment = null;
    while (bal > 0.005 && months < MAX_MONTHS) {
      var interest = bal * r;
      var pay = Math.max(interest + bal * (pctOfBalance / 100), floor);
      if (pay > bal + interest) pay = bal + interest;
      if (firstPayment === null) firstPayment = pay;
      bal = bal + interest - pay;
      interestTotal += interest;
      paidTotal += pay;
      months++;
    }
    return {
      mode: 'minimum',
      monthlyPayment: round2(firstPayment || 0),
      months: months,
      paysOff: bal <= 0.005,
      interest: round2(interestTotal),
      fees: 0,
      totalPaid: round2(paidTotal)
    };
  }

  /** Current path when the user gives a fixed monthly payment. */
  function fixedPaymentPath(balance, aprPct, payment) {
    var r = aprPct / 100 / 12;
    if (payment <= balance * r + 0.005) {
      return {
        mode: 'fixed', monthlyPayment: round2(payment), months: Infinity,
        paysOff: false, coversInterest: false,
        interest: Infinity, fees: 0, totalPaid: Infinity
      };
    }
    var bal = balance, months = 0, interestTotal = 0, paidTotal = 0;
    while (bal > 0.005 && months < MAX_MONTHS) {
      var interest = bal * r;
      var pay = Math.min(payment, bal + interest);
      bal = bal + interest - pay;
      interestTotal += interest;
      paidTotal += pay;
      months++;
    }
    return {
      mode: 'fixed',
      monthlyPayment: round2(payment),
      months: months,
      paysOff: bal <= 0.005,
      coversInterest: true,
      interest: round2(interestTotal),
      fees: 0,
      totalPaid: round2(paidTotal)
    };
  }

  /** Standard amortized payment. */
  function amortizedPayment(balance, aprPct, months) {
    var r = aprPct / 100 / 12;
    if (r === 0) return balance / months;
    return balance * r / (1 - Math.pow(1 + r, -months));
  }

  /** DMP path: reduced APR, fixed term, monthly program fee, optional setup fee. */
  function dmpPath(balance, program, termMonths) {
    var debtPayment = amortizedPayment(balance, program.dmpApr, termMonths);
    var interest = debtPayment * termMonths - balance;
    var fees = program.monthlyFee * termMonths + (program.setupFee || 0);
    return {
      mode: 'dmp',
      debtPayment: round2(debtPayment),
      monthlyFee: program.monthlyFee,
      monthlyPayment: round2(debtPayment + program.monthlyFee),
      months: termMonths,
      paysOff: true,
      interest: round2(interest),
      fees: round2(fees),
      totalPaid: round2(balance + interest + fees)
    };
  }

  /**
   * Main entry.
   * input:  { debt, currentApr, currentPayment (number|null), termMonths }
   * config: partner config (see config/partners/*.json)
   */
  function estimate(input, config) {
    var p = config.program, mp = config.minimumPayment;
    var debt = Math.max(0, Number(input.debt) || 0);
    var apr = Math.max(0, Number(input.currentApr) || 0);
    var term = Math.round(Math.min(p.termMax, Math.max(p.termMin, Number(input.termMonths) || p.termDefault)));
    var hasPayment = input.currentPayment !== null && input.currentPayment !== undefined &&
      input.currentPayment !== '' && Number(input.currentPayment) > 0;

    var current = hasPayment
      ? fixedPaymentPath(debt, apr, Number(input.currentPayment))
      : minimumPaymentPath(debt, apr, mp.percentOfBalance, mp.floor);
    var dmp = dmpPath(debt, p, term);

    var comparable = current.paysOff;
    var savings = comparable ? round2(current.totalPaid - dmp.totalPaid) : null;
    var monthsSooner = comparable ? current.months - dmp.months : null;

    var flags = {
      belowMinimumDebt: debt > 0 && debt < p.minDebt,
      paymentDoesNotCoverInterest: hasPayment && current.coversInterest === false,
      currentNeverPaysOff: !current.paysOff,
      dmpPaymentHigher: dmp.monthlyPayment > current.monthlyPayment + 0.5,
      noSavings: comparable && savings <= 0
    };

    return {
      input: { debt: debt, currentApr: apr, currentPayment: hasPayment ? Number(input.currentPayment) : null, termMonths: term },
      current: current,
      dmp: dmp,
      savings: savings,
      monthlyDifference: round2(current.monthlyPayment - dmp.monthlyPayment),
      monthsSooner: monthsSooner,
      flags: flags
    };
  }

  return {
    MAX_MONTHS: MAX_MONTHS,
    minimumPaymentPath: minimumPaymentPath,
    fixedPaymentPath: fixedPaymentPath,
    amortizedPayment: amortizedPayment,
    dmpPath: dmpPath,
    estimate: estimate
  };
});
