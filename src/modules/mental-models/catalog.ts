export interface MentalModel {
  name: string;
  description: string;
  steps: string[];
  example: string;
}

export const MENTAL_MODEL_CATALOG: MentalModel[] = [
  {
    name: "first-principles",
    description: "Break down a problem to its fundamental truths and rebuild from there, ignoring assumptions and conventional wisdom.",
    steps: [
      "Identify and challenge all assumptions about the problem",
      "Break the problem down to its most basic, fundamental truths",
      "List what you know to be absolutely true (not assumed)",
      "Rebuild the solution from these fundamental truths upward",
      "Check if the rebuilt solution differs from conventional approaches",
    ],
    example: "Elon Musk on battery costs: instead of accepting market price, break down to raw materials cost and derive that batteries can be far cheaper.",
  },
  {
    name: "inversion",
    description: "Instead of asking 'how do I succeed?', ask 'how do I guarantee failure?' and then avoid those paths.",
    steps: [
      "State the goal you want to achieve",
      "Invert the goal — what would cause the opposite outcome?",
      "List all the ways to guarantee failure or disaster",
      "Identify which of those failure modes you're currently doing",
      "Design your approach to systematically avoid the failure modes",
    ],
    example: "Instead of 'how do I build a successful product?', ask 'how do I build a product nobody wants?' — build in isolation, ignore feedback, over-engineer, delay launch.",
  },
  {
    name: "second-order",
    description: "Don't just consider the immediate consequences of an action — think about the consequences of those consequences.",
    steps: [
      "Identify the immediate (first-order) effects of the action",
      "For each first-order effect, ask 'and then what?'",
      "Map the second-order effects that emerge",
      "Continue to third-order if relevant (diminishing returns after that)",
      "Weigh the full chain of consequences before deciding",
    ],
    example: "Prescribing opioids (first order: pain relief). Second order: dependence. Third order: addiction epidemic, black market, overdose deaths.",
  },
  {
    name: "regret-minimization",
    description: "Project yourself to age 80 and ask which choice minimizes future regret. Optimizes for long-run satisfaction over short-run comfort.",
    steps: [
      "Imagine yourself at age 80, looking back at this decision",
      "Evaluate each option: would you regret choosing it?",
      "Identify which option 80-year-old you would be most proud of",
      "Separate short-term discomfort from long-term regret",
      "Choose the option that minimizes regret at life's end",
    ],
    example: "Jeff Bezos used this to decide whether to leave his hedge fund job to start Amazon. At 80, he wouldn't regret failing but would regret not trying.",
  },
  {
    name: "opportunity-cost",
    description: "Every choice forecloses other choices. The true cost of any decision includes what you give up by not choosing the alternatives.",
    steps: [
      "List the realistic alternatives to the current option",
      "Estimate the value of the best alternative you'd give up",
      "Add this foregone value as a hidden cost to the current option",
      "Compare options with their opportunity costs included",
      "Ask if the chosen option is worth what you're giving up",
    ],
    example: "Going to college: direct cost $200k + 4 years of salary foregone. The degree must be worth more than $200k + 4 years of working income.",
  },
  {
    name: "circle-of-competence",
    description: "Distinguish between what you actually know deeply versus what you merely think you know. Stay inside your circle when stakes are high.",
    steps: [
      "Define the domain you're operating in",
      "Honestly assess: where is your knowledge deep vs. superficial?",
      "Draw the boundary of your circle — where knowledge becomes thin",
      "Identify which parts of the decision fall outside your circle",
      "Decide: stay inside circle, expand circle first, or find someone whose circle covers this",
    ],
    example: "Warren Buffett doesn't invest in tech companies he doesn't understand, even when they appear to be great opportunities.",
  },
  {
    name: "map-territory",
    description: "Your mental model of reality is not reality itself. When your predictions fail, update your map — don't argue with the territory.",
    steps: [
      "Identify the mental model (map) you're using to navigate this situation",
      "List the assumptions baked into that map",
      "Look for evidence that contradicts the map",
      "Where map and territory diverge, trust the territory",
      "Update your map and note where it was wrong",
    ],
    example: "A startup's business model (map) assumes customers will pay $50/month. Real customers say $10 is their ceiling. The map is wrong — update it.",
  },
  {
    name: "hanlon-razor",
    description: "Never attribute to malice what can be adequately explained by stupidity, ignorance, or incompetence. Assumes the charitable interpretation first.",
    steps: [
      "Observe the behavior or outcome that seems negative",
      "List all explanations: malice, incompetence, ignorance, misunderstanding, accident",
      "Apply Occam's razor — which explanation requires fewer assumptions?",
      "Default to incompetence/ignorance unless evidence of malice is clear",
      "Act on the charitable interpretation first, escalate if disproved",
    ],
    example: "A colleague misses a deadline. Before assuming they're sabotaging the project, consider: unclear requirements, competing priorities, personal issues, skill gaps.",
  },
  {
    name: "occam-razor",
    description: "When multiple explanations fit the available facts, prefer the simplest one. Unnecessary complexity is usually a sign of a wrong model.",
    steps: [
      "List all competing explanations for the phenomenon",
      "Count the assumptions each explanation requires",
      "Identify which explanation is simplest while still fitting all facts",
      "Hold the simpler explanation as the working hypothesis",
      "Only accept a more complex explanation if it uniquely predicts something the simpler one can't",
    ],
    example: "Server is down. Occam's razor: check the obvious first (power, network, disk full) before diagnosing a complex race condition.",
  },
  {
    name: "probabilistic-thinking",
    description: "Think in distributions and probabilities, not binary outcomes. Assign likelihoods to scenarios and update them as evidence arrives.",
    steps: [
      "List the possible outcomes of the situation",
      "Assign explicit probabilities to each outcome (must sum to ~100%)",
      "Identify what evidence would shift the probabilities",
      "Update probabilities as new evidence arrives (Bayesian updating)",
      "Make decisions based on expected value, not most likely scenario alone",
    ],
    example: "A startup has 20% chance of 10x return, 50% chance of 1x, 30% chance of 0x. Expected value = 2+0.5+0 = 2.5x — better than the 50% modal case suggests.",
  },
  {
    name: "reversibility",
    description: "Categorize decisions by reversibility. Spend time proportional to irreversibility — be fast on reversible, cautious on irreversible.",
    steps: [
      "Assess: is this decision reversible or irreversible (one-way door)?",
      "For reversible decisions: decide quickly with available info, learn by doing",
      "For irreversible decisions: slow down, gather more data, stress-test assumptions",
      "Ask: what's the cost of being wrong in each direction?",
      "Match your decision-making process to the reversibility of the outcome",
    ],
    example: "Choosing a SaaS tool: reversible — try it, switch if needed. Acquiring a company: irreversible — due diligence is worth months of delay.",
  },
  {
    name: "pre-mortem",
    description: "Imagine the project has already failed spectacularly. Work backward to identify what went wrong. Surfaces risks before they materialize.",
    steps: [
      "Assume it's 12 months from now and the project has completely failed",
      "Write a detailed story of how the failure unfolded",
      "List every contributing factor — technical, organizational, market, human",
      "Prioritize the failure modes by likelihood and impact",
      "Add specific mitigations for the top failure modes to the current plan",
    ],
    example: "Before launching a feature: 'It's 6 months later and the feature flopped. Why? Slow performance, nobody understood the UX, it cannibalized a better feature, we shipped too many bugs.' Fix those before launch.",
  },
];

export function getModelByName(name: string): MentalModel | undefined {
  return MENTAL_MODEL_CATALOG.find((m) => m.name === name);
}

export function getAllModelNames(): string[] {
  return MENTAL_MODEL_CATALOG.map((m) => m.name);
}
