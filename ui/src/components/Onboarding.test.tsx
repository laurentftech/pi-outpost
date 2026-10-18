import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CredentialStatus } from "@pi-outpost/shared";
import type { LoginFlowState } from "../useAgent";
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
  const props: Props = { credentials: credentials(), errors: [], onSetCredential, onStartLogin: vi.fn(), login: null, onAnswerLogin: vi.fn(), onCancelLogin: vi.fn(), onDismissLogin: vi.fn(), onDeclareProvider, ...overrides };
  const view = render(<Onboarding {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<Onboarding {...props} {...next} />);
  return { onSetCredential, onDeclareProvider, rerenderWith };
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save and start" }));
const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Onboarding", () => {
  it("offers account sign-in during first-run setup", () => {
    const onStartLogin = vi.fn();
    setup({ credentials: credentials({ signIn: true, providers: [{ id: "codex", name: "OpenAI Codex", configured: false, methods: ["oauth"] }] }), onStartLogin });
    fireEvent.click(screen.getByRole("button", { name: "OpenAI Codex" }));
    expect(onStartLogin).toHaveBeenCalledWith("codex", "oauth");
  });
  it("closes the selected provider when clicked again without showing a cancellation result", () => {
    const onStartLogin = vi.fn();
    const onCancelLogin = vi.fn();
    const onDismissLogin = vi.fn();
    const view = setup({
      credentials: credentials({ signIn: true, providers: [{ id: "anthropic", name: "Anthropic", configured: false, methods: ["oauth"] }] }),
      login: { flowId: "flow-1", provider: "anthropic", method: "oauth", events: [], prompt: null, done: null },
      onStartLogin, onCancelLogin, onDismissLogin,
    });
    const provider = screen.getByRole("button", { name: "Anthropic" });
    expect(provider).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(provider);
    expect(onStartLogin).not.toHaveBeenCalled();
    expect(onCancelLogin).toHaveBeenCalledOnce();
    expect(onDismissLogin).toHaveBeenCalledOnce();
    view.rerenderWith({ login: null });
    expect(screen.queryByTestId("login-flow")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign-in cancelled.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anthropic" })).toHaveAttribute("aria-expanded", "false");
  });
  it("switches directly to another account provider while a sign-in is running", () => {
    const onStartLogin = vi.fn();
    const onCancelLogin = vi.fn();
    const onDismissLogin = vi.fn();
    const view = setup({
      credentials: credentials({ signIn: true, providers: [
        { id: "anthropic", name: "Anthropic", configured: false, methods: ["oauth"] },
        { id: "openai", name: "OpenAI", configured: false, methods: ["oauth"] },
      ] }),
      login: { flowId: "flow-1", provider: "anthropic", method: "oauth", events: [], prompt: null, done: null },
      onStartLogin, onCancelLogin, onDismissLogin,
    });
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(onCancelLogin).toHaveBeenCalledOnce();
    expect(onDismissLogin).toHaveBeenCalledOnce();
    expect(onStartLogin).toHaveBeenCalledWith("openai", "oauth");
    view.rerenderWith({ login: { flowId: "flow-2", provider: "openai", method: "oauth", events: [], prompt: null, done: null } });
    expect(screen.getByText("Signing in to OpenAI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OpenAI" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Anthropic" })).toHaveAttribute("aria-expanded", "false");
  });
  it("renders the account prompt and routes its answer and cancellation", () => {
    const onAnswerLogin = vi.fn();
    const onCancelLogin = vi.fn();
    const login: LoginFlowState = {
      provider: "codex",
      events: [{ type: "auth_url", url: "https://example.test/sign-in" }],
      prompt: { promptId: "p1", prompt: { type: "manual_code", message: "Paste the code" } },
      done: null,
    };
    setup({
      credentials: credentials({ signIn: true, providers: [{ id: "codex", name: "OpenAI Codex", configured: false, methods: ["oauth"] }] }),
      login, onAnswerLogin, onCancelLogin,
    });
    expect(screen.getByRole("link", { name: "https://example.test/sign-in" })).toHaveAttribute("target", "_blank");
    fireEvent.change(screen.getByLabelText(/Paste the code/), { target: { value: "  ABCD  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAnswerLogin).toHaveBeenCalledWith("ABCD");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelLogin).toHaveBeenCalledOnce();
  });
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
