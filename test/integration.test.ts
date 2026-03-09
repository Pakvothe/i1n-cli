import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { initCommand } from "../src/cli/commands/init.js";
import { pushCommand } from "../src/cli/commands/push.ts";
import { pullCommand } from "../src/cli/commands/pull.ts";
import { setupAiCommand } from "../src/cli/commands/setup-ai.ts";
import * as config from "../src/shared/config.js";
import * as supabase from "../src/shared/supabase.js";
import * as prompts from "@clack/prompts";
import * as parsers from "../src/parsers/index.js";
import * as aiConfig from "../src/shared/ai-config.js";
import type {
  ValidateResponse,
  ProjectLimitsResponse,
  PushResponse,
  PullResponse,
  ProjectSettingsResponse,
} from "../src/shared/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// --- Global Mocks for External Modules ---
mock.module("../src/shared/supabase.js", () => ({
  callCliSync: mock(),
}));

mock.module("../src/parsers/index.js", () => ({
  getParser: mock().mockReturnValue({
    read: () => ({ wordings: [], warnings: [] }),
    write: mock(),
  }),
}));

mock.module("../../detector/index.js", () => ({
  detect: mock().mockResolvedValue({
    format: "nested-json",
    localesDir: "locales",
    sourceLocale: "en_us",
    framework: "generic",
  }),
  detectFramework: mock().mockReturnValue("generic"),
}));

mock.module("@clack/prompts", () => ({
  intro: mock(),
  outro: mock(),
  confirm: mock().mockResolvedValue(true),
  select: mock().mockResolvedValue("1"),
  text: mock().mockResolvedValue("i1n_0123456789abcdef0123456789abcdef"),
  multiselect: mock().mockResolvedValue([]),
  cancel: mock(),
  spinner: () => ({
    start: mock(),
    stop: mock(),
    message: mock(),
  }),
  isCancel: (val: any) => val === Symbol.for("clack:cancel"),
  log: {
    info: mock(),
    warn: mock(),
    error: mock(),
    success: mock(),
  },
}));

// Mock config module to avoid real file I/O during tests
mock.module("../src/shared/config.js", () => ({
  ...config,
  projectConfigExists: mock().mockReturnValue(false),
  writeProjectConfig: mock(),
  readProjectConfig: mock().mockReturnValue({
    apiKey: "i1n_test_key",
    projectId: "test-proj-id",
    localesDir: "locales",
    sourceLocale: "en_us",
    format: "nested-json",
    framework: "generic",
  }),
  ensureGitignore: mock(),
}));

describe("CLI Integration Suite", () => {
  let tempDir: string;
  const originalExit = process.exit;

  beforeEach(() => {
    // Reset all mocks to ensure test isolation
    (prompts.log.info as any).mockReset();
    (prompts.log.warn as any).mockReset();
    (prompts.log.error as any).mockReset();
    (prompts.log.success as any).mockReset();
    (prompts.intro as any).mockReset();
    (prompts.outro as any).mockReset();
    (prompts.select as any).mockReset();
    (prompts.confirm as any).mockReset();
    (prompts.text as any).mockReset();
    (prompts.multiselect as any).mockReset();
    (prompts.cancel as any).mockReset();

    (supabase.callCliSync as any).mockReset();
    (parsers.getParser as any).mockReset();

    // Re-apply global defaults
    (prompts.confirm as any).mockResolvedValue(true);
    (prompts.select as any).mockResolvedValue("1");
    (prompts.text as any).mockResolvedValue(
      "i1n_0123456789abcdef0123456789abcdef",
    );
    (prompts.multiselect as any).mockResolvedValue([]);

    (parsers.getParser as any).mockReturnValue({
      read: () => ({ wordings: [], warnings: [] }),
      write: () => {},
    });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-int-test-"));
    // Mock process.exit to verify failure paths without crashing the runner
    (process as any).exit = mock((code?: number) => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit = originalExit;
  });

  const expectExit = async (fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (e: any) {
      if (e.message === "process.exit") return;
      throw e;
    }
  };

  describe("init command", () => {
    it("should handle locked projects during setup", async () => {
      const mockValidate: ValidateResponse = {
        org_id: "org_123",
        org_name: "Acme Corp",
        projects: [
          {
            id: "proj_1",
            name: "Main App",
            is_locked: false,
            used_languages: ["en_us"],
          },
          {
            id: "proj_2",
            name: "Legacy Portal",
            is_locked: true,
            used_languages: ["en_us", "es_es"],
          },
        ],
      };

      (supabase.callCliSync as any)
        .mockResolvedValueOnce(mockValidate)
        .mockResolvedValueOnce({ tone_preset: "formal", brand_voice: "" }) // settings
        .mockResolvedValueOnce({ wordings: [], languages: [], namespaces: [] }); // pull

      await initCommand.parseAsync([], { from: "user" });

      const selectCall = (prompts.select as any).mock.calls[0][0];
      expect(selectCall.options).toContainEqual({
        value: "proj_2",
        label: "Legacy Portal (locked - upgrade your plan)",
        hint: "Read-Only",
      });
    });

    it("should retry on invalid API key then succeed", async () => {
      (supabase.callCliSync as any)
        .mockRejectedValueOnce(new Error("Invalid API key"))
        .mockResolvedValue({
          org_id: "org_123",
          org_name: "Acme Corp",
          projects: [
            { id: "proj_1", name: "P1", is_locked: false, used_languages: [] },
          ],
          tone_preset: "formal",
          wordings: [],
          languages: [],
          namespaces: [],
        });

      (prompts.text as any)
        .mockResolvedValueOnce("bad_key")
        .mockResolvedValue("i1n_0123456789abcdef0123456789abcdef");

      await initCommand.parseAsync([], { from: "user" });
      expect(prompts.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Invalid API key"),
      );
      expect(supabase.callCliSync).toHaveBeenCalledTimes(4);
    });

    it("should abort gracefully on user cancel", async () => {
      (prompts.text as any).mockResolvedValueOnce(Symbol.for("clack:cancel"));
      await initCommand.parseAsync([], { from: "user" });
      expect(prompts.cancel).toHaveBeenCalled();
    });
  });

  describe("push command", () => {
    it("should abort if the project is locked (Plan Downgrade Shield)", async () => {
      (supabase.callCliSync as any).mockResolvedValue({ is_locked: true });
      (parsers.getParser as any).mockReturnValue({
        read: () => ({
          wordings: [{ key: "k", namespace: "ns", value_json: { en: "v" } }],
          warnings: [],
        }),
      });

      await pushCommand.parseAsync([], { from: "user" });
      expect(prompts.log.error).toHaveBeenCalledWith(
        expect.stringContaining("locked"),
      );
    });

    it("should warn when language limits are reached (e.g. pt_br blocked)", async () => {
      const mockLimits: ProjectLimitsResponse = {
        plan_id: "free",
        is_locked: false,
        wordings: { used: 0, limit: 100 },
        credits: { used: 0, limit: 1000 },
        languages: {
          active: ["en_us", "es_es"],
          used: ["en_us", "es_es"],
          limit: 2,
          remaining_slots: 0,
        },
        supported_codes: ["en_us", "es_es", "pt_br"],
        available_languages: [],
      };

      (supabase.callCliSync as any)
        .mockResolvedValueOnce(mockLimits)
        .mockResolvedValueOnce({ created: 1, updated: 0 }) // push
        .mockResolvedValueOnce({ estimated_cost: 0 }); // estimate

      (parsers.getParser as any).mockReturnValue({
        read: () => ({
          wordings: [
            {
              key: "k",
              namespace: "ns",
              value_json: { en_us: "v", pt_br: "v2" },
            },
          ],
          warnings: [],
        }),
      });

      await pushCommand.parseAsync([], { from: "user" });
      expect(prompts.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Language limit reached"),
      );
    });
  });

  describe("pull command", () => {
    it("should write files on successful pull", async () => {
      const mockPull: PullResponse = {
        wordings: [
          {
            key: "welcome",
            namespace: "app",
            value_json: { en_us: "Welcome" },
          },
        ],
        languages: [{ code: "en_us", name: "English" }],
        namespaces: [{ name: "app" }],
      };

      (supabase.callCliSync as any).mockResolvedValue(mockPull);
      const writeMock = mock(() => {});
      (parsers.getParser as any).mockReturnValue({ write: writeMock });

      await pullCommand.parseAsync([], { from: "user" });
      expect(writeMock).toHaveBeenCalled();
      expect(prompts.outro).toHaveBeenCalled();
    });
  });

  describe("setup-ai command", () => {
    it("should generate tool-specific AI configurations", async () => {
      (supabase.callCliSync as any).mockResolvedValue({
        tone_preset: "technical",
      });
      (prompts.multiselect as any).mockResolvedValue(["cursor"]);

      await setupAiCommand.parseAsync([], { from: "user" });
      expect(prompts.outro).toHaveBeenCalled();
    });

    it("should fail gracefully if no project config exists", async () => {
      (config.readProjectConfig as any).mockReturnValueOnce(null);
      await expectExit(() => setupAiCommand.parseAsync([], { from: "user" }));
      expect(prompts.log.error).toHaveBeenCalledWith(
        expect.stringContaining("No i1n.config.json found"),
      );
    });
  });

  describe("shared AI config logic", () => {
    it("should generate comprehensive instructions with tone", () => {
      const mockConf: any = {
        format: "nested-json",
        localesDir: "L",
        sourceLocale: "en",
        framework: "next-intl",
      };
      const res = aiConfig.generateI1nInstructions(mockConf, {
        tone_preset: "formal",
      });
      expect(res).toContain("formal");
      expect(res).toContain("next-intl");
    });

    it("should upsert content into existing AI rule files", () => {
      const filePath = path.join(tempDir, "CLAUDE.md");
      fs.writeFileSync(filePath, "# Existing Rules\n");

      aiConfig.writeAIConfigs(["claude"], {} as any, undefined, tempDir);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# Existing Rules");
      expect(content).toContain("<!-- i1n:start -->");
    });
  });
});
