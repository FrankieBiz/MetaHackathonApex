// Plain-English hover help for the terminal's trading-desk vocabulary, shared
// so every panel explains a metric the same way.

export const GLOSSARY = {
  var: "Value at Risk (VaR, 90%): how many points your course grade could slip in a bad stretch. In 1 of every 10 simulated semesters, your remaining work lands this far below your current grade. Smaller is safer.",
  volatility:
    "Volatility: how bunched-up your deadlines are over the next 14 days. Low means work is spread evenly; high (200+) means several deadlines pile onto the same days, so one bad night can hurt more than one grade.",
  marginOfSafety:
    "Margin of Safety: how far your current grade sits above (or below) your target. +3.0 means you could lose 3 grade points and still hit your goal; a negative number means you are behind it.",
  marginProtected:
    "Margin protected: final-grade points this one step secures. It is the deliverable's grade weight times this task's share of the plan's estimated time.",
  gradeFloor:
    "Grade floor: the lowest score on this deliverable that keeps the course on target, assuming the rest of your work holds at your current grade.",
} as const;
