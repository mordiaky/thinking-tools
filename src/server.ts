import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerIdeaLabTools } from "./modules/idea-lab/tools.js";
import { registerHypothesisTools } from "./modules/hypothesis/tools.js";
import { registerDecisionMatrixTools } from "./modules/decision-matrix/tools.js";
import { registerMentalModelTools } from "./modules/mental-models/tools.js";
import { registerAssumptionTrackerTools } from "./modules/assumption-tracker/tools.js";
import { registerContradictionDetectorTools } from "./modules/contradiction-detector/tools.js";
import { registerLearningJournalTools } from "./modules/learning-journal/tools.js";
import { registerArgumentMapperTools } from "./modules/argument-mapper/tools.js";
import { registerIntegrationTools } from "./modules/integrations/tools.js";

const server = new McpServer({
  name: "thinking-tools",
  version: "1.0.0",
});

registerIdeaLabTools(server);
registerHypothesisTools(server);
registerDecisionMatrixTools(server);
registerMentalModelTools(server);
registerAssumptionTrackerTools(server);
registerContradictionDetectorTools(server);
registerLearningJournalTools(server);
registerArgumentMapperTools(server);
registerIntegrationTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[thinking-tools] server running\n");
