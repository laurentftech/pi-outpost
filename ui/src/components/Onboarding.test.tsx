import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CredentialStatus } from "@pi-outpost/shared";
import { Onboarding } from "./Onboarding";

function credentials(overrides: Partial<CredentialStatus> = {}): CredentialStatus {
  return {
    providers: [
      { id: "anthropic", name: "Anthropic", configured: false },
      { id: "openai", name: "OpenAI", configured: false },
    ],
    usableModel: false,
    agentDir: "/home/ada/.pi/agent",
    ...overrides,
  } as CredentialStatus;
}

type Props = React.ComponentProps<typeof Onboarding>;

function setup(overrides: Partial<Props> = {}) {
  const onSetCredential = vi.fn();
  const onDeclareProvider = vi.fn();
  const props: Props = { credentials: credentials(), errors: [], onSetCredential, onDeclareProvider, ...overrides };
  render(<Onboarding {...props} />);
  return { onSetCredential, onDeclareProvider };
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save and start" }));
const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Onboarding", () => {
  describe("a provider the server already knows", () => {
    it("opens on the key form when there are known providers", () => {
      setup();
      expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    });

    it("stores a key for the chosen provider", () => {
      const { onSetCredential } = setup();
      fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
      fill("API key", "sk-abc");
      submit();
      expect(onSetCredential).toHaveBeenCalledWith("openai", "sk-abc");
    });

    it("trims the key, since a copy-paste often brings whitespace", () => {
      const { onSetCredential } = setup();
      fill("API key", "  sk-abc  ");
      submit();
      expect(onSetCredential).toHaveBeenCalledWith("anthropic", "sk-abc");
    });

    it("does nothing without a key", () => {
      const { onSetCredential } = setup();
      fill("API key", "   ");
      submit();
      expect(onSetCredential).not.toHaveBeenCalled();
    });

    it("says which providers are already configured", () => {
      // usableModel matters here: a configured provider with nothing usable takes the
      // "configured but unusable" branch instead, which renders no form at all
      setup({
        credentials: credentials({
          providers: [{ id: "anthropic", name: "Anthropic", configured: true }],
          usableModel: true,
        } as Partial<CredentialStatus>),
      });
      expect(screen.getByRole("option", { name: /already configured/ })).toBeInTheDocument();
    });
  });

  describe("an endpoint of your own", () => {
    const openCustom = () => fireEvent.click(screen.getByRole("button", { name: "OpenAI-compatible endpoint" }));

    it("opens there when the server knows no provider at all", () => {
      setup({ credentials: credentials({ providers: [] }) });
      expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
    });

    it("declares the endpoint with its single model", () => {
      const { onDeclareProvider } = setup();
      openCustom();
      fill("Name", "corp");
      fill("Base URL", "https://llm.corp.example/v1");
      fill("Model id", "gpt-oss-120b");
      fill("API key", "sk-corp");
      submit();
      expect(onDeclareProvider).toHaveBeenCalledWith({
        provider: "corp",
        baseUrl: "https://llm.corp.example/v1",
        apiKey: "sk-corp",
        models: ["gpt-oss-120b"],
        compat: { supportsDeveloperRole: true, supportsReasoningEffort: true },
      });
    });

    it("refuses an incomplete declaration rather than sending half of one", () => {
      const { onDeclareProvider } = setup();
      openCustom();
      fill("Name", "corp");
      fill("API key", "sk-corp");
      submit();
      expect(onDeclareProvider).not.toHaveBeenCalled();
    });

    it("carries the compatibility answers, which decide whether every turn works", () => {
      const { onDeclareProvider } = setup();
      openCustom();
      fill("Name", "corp");
      fill("Base URL", "https://llm.corp.example/v1");
      fill("Model id", "gpt-oss-120b");
      fill("API key", "sk-corp");
      fireEvent.click(screen.getByRole("checkbox", { name: /developer/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /reasoning_effort/ }));
      submit();
      expect(onDeclareProvider).toHaveBeenCalledWith(
        expect.objectContaining({ compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }),
      );
    });

    it("offers the compatibility questions only for a custom endpoint", () => {
      setup();
      expect(screen.queryByRole("checkbox", { name: /developer/ })).not.toBeInTheDocument();
      openCustom();
      expect(screen.getByRole("checkbox", { name: /developer/ })).toBeInTheDocument();
    });
  });

  describe("configured but unusable", () => {
    const unusable = credentials({
      providers: [{ id: "anthropic", name: "Anthropic", configured: true }],
      usableModel: false,
    } as Partial<CredentialStatus>);

    it("does not ask for a key that is not what is missing", () => {
      setup({ credentials: unusable });
      expect(screen.getByText("No model is available.")).toBeInTheDocument();
      expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    });

    it("names allowedModels as the thing to widen", () => {
      setup({ credentials: unusable });
      expect(screen.getByText(/allowedModels/)).toBeInTheDocument();
    });
  });

  describe("feedback", () => {
    it("shows what the server complained about", () => {
      setup({ errors: ["Cannot write to /home/ada/.pi/agent", "Certificate could not be verified"] });
      expect(screen.getByText("Cannot write to /home/ada/.pi/agent")).toBeInTheDocument();
      expect(screen.getByText("Certificate could not be verified")).toBeInTheDocument();
    });

    it("says where a key would be stored", () => {
      setup();
      expect(screen.getByText(/Stored in \/home\/ada\/\.pi\/agent/)).toBeInTheDocument();
    });

    it("keeps the key out of view while it is typed", () => {
      setup();
      expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
    });

    it("uses the branded title when there is one", () => {
      setup({ title: "π dev" });
      expect(screen.getByText("π dev")).toBeInTheDocument();
    });
  });
});
