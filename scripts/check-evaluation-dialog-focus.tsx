/**
 * Interactive regression: Motivo keeps focus while typing in Editar avaliação.
 *
 * Reproduces the production bug where an unstable onClose identity re-ran the
 * dialog open effect and stole focus to "Fechar" after each keystroke.
 *
 *   npm run check:evaluation-dialog-focus
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const React = await import("react");
  const { createElement, useCallback, useMemo, useRef, useState, act } = React;
  const { createRoot } = await import("react-dom/client");
  const { ResponsiveDialog } = await import(
    "../src/app/(app)/admin/players/[memberId]/responsive-dialog"
  );

  type FormEvent = React.FormEvent;
  type ReactElement = React.ReactElement;
  type Root = import("react-dom/client").Root;

  const results: { name: string; ok: boolean; detail?: string }[] = [];
  function check(name: string, ok: boolean, detail?: string) {
    results.push({ name, ok, detail });
  }

  function flush() {
    return act(async () => {
      await Promise.resolve();
    });
  }

  function typeInto(input: HTMLInputElement, text: string) {
    const proto = window.HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!valueSetter) throw new Error("HTMLInputElement value setter ausente");

    for (const char of text) {
      act(() => {
        input.focus();
        const next = `${input.value}${char}`;
        valueSetter.call(input, next);
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            data: char,
            inputType: "insertText",
          }),
        );
      });
      check(
        `Motivo retains focus after "${char}"`,
        document.activeElement === input,
        `active=${(document.activeElement as HTMLElement | null)?.textContent?.slice(0, 40) ?? document.activeElement?.nodeName}`,
      );
    }
  }

  function EvaluationDialogHarness({
    stabilizeClose,
  }: {
    stabilizeClose: boolean;
  }): ReactElement {
    const [open, setOpen] = useState(false);
    const [overall, setOverall] = useState(3);
    const [reason, setReason] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const stableClose = useCallback(() => setOpen(false), []);
    const close = stabilizeClose ? stableClose : () => setOpen(false);
    const dirty = useMemo(() => overall !== 3, [overall]);

    return (
      <div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setOverall(3);
            setReason("");
            setOpen(true);
          }}
        >
          Editar avaliação
        </button>
        <ResponsiveDialog
          open={open}
          onClose={close}
          title="Editar avaliação"
          description="Ajuste as notas."
          triggerRef={triggerRef}
          footer={
            <div>
              <button type="button" disabled={!dirty}>
                Salvar avaliação
              </button>
              <button type="button" onClick={close}>
                Cancelar
              </button>
            </div>
          }
        >
          <form onSubmit={(event: FormEvent) => event.preventDefault()}>
            <button type="button" onClick={() => setOverall(4)}>
              Overall 4
            </button>
            <button type="button" onClick={() => setOverall(3)}>
              Overall 3
            </button>
            <label>
              Por que alterar esta avaliação?
              <input
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={dirty}
                disabled={!dirty}
                placeholder="Obrigatório quando houver mudanças"
              />
            </label>
          </form>
        </ResponsiveDialog>
      </div>
    );
  }

  async function mount(stabilizeClose: boolean): Promise<{ root: Root; container: HTMLDivElement }> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(EvaluationDialogHarness, { stabilizeClose }));
    });
    await flush();
    return { root, container };
  }

  async function openDialog(container: HTMLElement) {
    const trigger = container.querySelector("button") as HTMLButtonElement | null;
    if (!trigger) throw new Error("trigger ausente");
    await act(async () => {
      trigger.click();
    });
    await flush();
  }

  function motivoInput(): HTMLInputElement {
    const input = document.querySelector('input[name="reason"]') as HTMLInputElement | null;
    if (!input) throw new Error("Motivo input ausente");
    return input;
  }

  function fecharButton(): HTMLButtonElement {
    const btn = [...document.querySelectorAll("button")].find((el) => el.textContent === "Fechar");
    if (!btn) throw new Error("Fechar ausente");
    return btn as HTMLButtonElement;
  }

  {
    const { root, container } = await mount(false);
    await openDialog(container);

    check(
      "open autofocuses Fechar (first focusable)",
      document.activeElement === fecharButton(),
      `active=${document.activeElement?.textContent}`,
    );

    const overall4 = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Overall 4",
    ) as HTMLButtonElement;
    await act(async () => {
      overall4.click();
    });
    await flush();

    const input = motivoInput();
    check("Motivo enabled after dirty", !input.disabled);

    await act(async () => {
      input.focus();
    });
    check("Motivo can receive focus", document.activeElement === input);

    typeInto(input, "ajuste");
    check("Motivo value retained", input.value === "ajuste", `value=${input.value}`);
    check(
      "Fechar is not focused after typing",
      document.activeElement !== fecharButton() && document.activeElement === input,
    );

    await act(async () => {
      input.focus();
    });
    await act(async () => {
      overall4.click();
    });
    await flush();
    await act(async () => {
      motivoInput().focus();
    });
    typeInto(motivoInput(), " ok");
    check(
      "Motivo still focused after more typing",
      document.activeElement === motivoInput() && motivoInput().value === "ajuste ok",
      `value=${motivoInput().value}`,
    );

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    check("Escape closes dialog", document.querySelector('[role="dialog"]') == null);
    check(
      "Escape returns focus to trigger",
      document.activeElement?.textContent === "Editar avaliação",
      `active=${document.activeElement?.textContent}`,
    );

    await openDialog(container);
    check("reopen shows dialog", document.querySelector('[role="dialog"]') != null);
    await act(async () => {
      fecharButton().click();
    });
    await flush();
    check("Fechar closes dialog", document.querySelector('[role="dialog"]') == null);

    await openDialog(container);
    const overallBtn = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Overall 4",
    ) as HTMLButtonElement;
    await act(async () => {
      overallBtn.click();
    });
    await flush();
    const save = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Salvar avaliação",
    ) as HTMLButtonElement;
    check("Salvar enabled when dirty", !save.disabled);
    const cancel = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Cancelar",
    ) as HTMLButtonElement;
    await act(async () => {
      cancel.click();
    });
    await flush();
    check("Cancelar closes dialog", document.querySelector('[role="dialog"]') == null);

    await openDialog(container);
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    const focusables = [
      ...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.hasAttribute("disabled"));
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    await act(async () => {
      last.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    check("Tab from last wraps to first", document.activeElement === first);
    await act(async () => {
      first.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      );
    });
    check("Shift+Tab from first wraps to last", document.activeElement === last);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  {
    const { root, container } = await mount(true);
    await openDialog(container);
    const overall4 = [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Overall 4",
    ) as HTMLButtonElement;
    await act(async () => {
      overall4.click();
    });
    await flush();
    const input = motivoInput();
    await act(async () => {
      input.focus();
    });
    typeInto(input, "xyz");
    check(
      "stable onClose also keeps Motivo focus",
      document.activeElement === input && input.value === "xyz",
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} falha(s) de ${results.length}`);
    process.exit(1);
  }
  console.log(`\n${results.length} checks ok`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
