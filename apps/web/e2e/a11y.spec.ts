import { expect, test } from "@playwright/test";

/**
 * Public-surface a11y baseline e2e — Story 3.5.
 *
 * Surface-anchored coverage for the AC1 / AC2 baseline laid down in 3.5:
 *
 *   - AC1 reachability: Tab through `/` and assert the sequence hits real
 *     `<a>`/`<button>`/`<input>` focusable elements (never a `<div>`), i.e.
 *     no `div onClick` trap exists on any public surface.
 *   - AC1 skip-to-content: the skip-link is the first focusable element,
 *     and activating it (Enter) moves focus to `<main id="main">` so keyboard
 *     readers can bypass the entire nav.
 *   - AC1 visible focus: a keyboard-focused nav link shows a non-`none`
 *     outline with the brand `--color-focus-ring` color (the global
 *     `:where(...):focus-visible` rule in globals.css is in effect for
 *     elements without a component-level `focus:ring-*` class).
 *   - AC2 non-color guard: `/design` (DB-free) renders the three ReactionChip
 *     tones with visible CJK text 「涨」「跌」「平」 — color is not the only
 *     signal. This locks the color+text invariant against a silent color-only
 *     regression.
 *
 * Infrastructure note: `/` is `force-dynamic` and reads `published_hot_events`
 * at request time (AD-3 public read — same as home.spec.ts), so this file
 * requires a reachable local PG `aguhot_dev`. `/design` is DB-free (a static
 * server component rendering token samples), so the AC2 guard has no DB
 * dependency.
 *
 * The skip-link is an unscoped `<a href="#main">` rendered before `<PublicNav>`
 * inside `(public)/layout.tsx`. navigation.spec.ts scopes its link assertions
 * to the `complementary` (desktop aside) / `dialog` (mobile drawer) /
 * `banner` (mobile header) landmarks, so adding a pre-nav link here does NOT
 * perturb those existing assertions (verified during 3.5 implementation).
 */

test.describe("公开页面语义与键盘可达基线 (Story 3.5) @a11y", () => {
  test("键盘 Tab 序列命中真实可聚焦元素，无 div-onclick 陷阱 (AC1 可达)", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);

    // Reset focus to the document body so the first Tab lands on the
    // intended first-focusable (the skip-link). Playwright's default focus
    // state can vary by browser; this makes the sequence deterministic.
    await page.evaluate(() => document.body.focus());

    // The first Tab MUST land on the skip-link — it is the first focusable
    // element in the (public) route tree. Pin the identity (not just "an
    // <a>") by comparing the focused element to the skip-link locator.
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });
    await expect(skipLink).toBeFocused();

    // Record the first stop's tag for the sequence-membership assertions
    // below, then continue Tabbing through the rest of the page.
    const seenTags: string[] = [
      await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.tagName ?? "",
      ),
    ];

    // Tab through a bounded number of additional stops — enough to traverse
    // the primary nav links and the global search input. We do NOT assert
    // the whole page; we assert (a) at least one A and one INPUT are reached,
    // and (b) no activeElement is ever a `<div>` (div-onclick trap).
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.tagName ?? "",
      );
      if (tag) seenTags.push(tag);
      // AC1: every keyboard focus stop MUST be a real focusable element type.
      // A `<div>` here would indicate a `div onClick` trap (keyboard
      // unreachable interaction) — the baseline this story guards against.
      expect(tag, `Tab stop #${i + 2} must not be a <div> onclick trap`).not.toBe(
        "DIV",
      );
    }

    // The sequence must contain real focusable types beyond the skip-link:
    // at least one <A> (nav links) and one <INPUT> (the global search box).
    // This is the surface proof of AC1 "all core interactions reachable".
    expect(seenTags, "Tab sequence must include at least one link").toContain(
      "A",
    );
    expect(
      seenTags,
      "Tab sequence must include at least one input (global search)",
    ).toContain("INPUT");
  });

  test("skip-link 按 Enter 后焦点移至 <main id=\"main\"> (AC1 可达基线原语)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });

    // First Tab reaches the skip-link.
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    // Activate it. Because `<main tabIndex={-1}>` is programmatically
    // focusable, the browser moves focus to #main instead of jumping to the
    // first link inside main.
    await page.keyboard.press("Enter");

    // `expect.poll` because focus assignment after hash navigation can be
    // async in some browsers; poll until activeElement.id settles on "main".
    await expect.poll(async () => {
      const id = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.id ?? "",
      );
      return id;
    }, "focus should move to <main id=\"main\"> after skip-link activation").toBe(
      "main",
    );
  });

  test("skip-link 未聚焦时视觉隐藏、不占布局 (sr-only)", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });

    // `sr-only` clips the link to a 1px box and pulls it out of the normal
    // flow, so a sighted mouse user never perceives it until keyboard focus
    // reveals it (focus:not-sr-only). A skip-link that is always visible
    // would be a layout/visual defect — this guards that contract.
    const box = await skipLink.boundingBox();
    expect(box, "skip-link must exist in the DOM").not.toBeNull();
    expect(
      box!.width,
      "unfocused skip-link must be sr-only (clipped to ≤1px wide)",
    ).toBeLessThanOrEqual(1);
    expect(
      box!.height,
      "unfocused skip-link must be sr-only (clipped to ≤1px tall)",
    ).toBeLessThanOrEqual(1);
  });

  test("既有 SearchBox ring 未被全局焦点规则覆盖 (AC1 不回归)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    // Tab until the global search input (in PublicNav) is focused.
    let inputFocused = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.tagName ?? "",
      );
      if (tag === "INPUT") {
        inputFocused = true;
        break;
      }
    }
    expect(inputFocused, "global search input must be keyboard-reachable").toBe(
      true,
    );

    // SearchBox keeps its own `focus-visible:ring-2` (Tailwind ring compiles
    // to box-shadow). The global `:where(...):focus-visible` rule has
    // specificity 0, so it must NOT override the component ring — assert the
    // ring (box-shadow) is still present AND carries the brand focus-ring
    // color, not just any shadow (a generic elevation shadow would falsely
    // satisfy a bare `!== "none"` check). Tailwind serializes the ring color
    // via `--tw-ring-color` set to the focus-ring token.
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? getComputedStyle(el).boxShadow : "none";
      });
    }, "SearchBox ring (box-shadow) must survive the global focus rule").not.toBe(
      "none",
    );
    const ringShadow = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).boxShadow : "";
    });
    expect(
      ringShadow.replace(/[\s,]/g, ""),
      "SearchBox ring must carry the brand focus-ring color (#335a91), not a generic shadow",
    ).toMatch(/51.*90.*145/);
  });

  test("键盘聚焦的 nav 链接显示品牌色可见焦点 outline (AC1 可见焦点)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    // Tab past the skip-link (first stop) to reach the first nav link.
    await page.keyboard.press("Tab"); // skip-link
    await page.keyboard.press("Tab"); // → first focusable nav element

    // The activeElement is a nav link without any component-level
    // `focus:ring-*` class, so it should pick up the global
    // `:where(a, button, ...):focus-visible` outline rule from globals.css.
    // Asserting outline-style != "none" is the surface proof the rule is in
    // effect (a regression that removes the rule collapses outline-style
    // back to the browser default `none` for plain links).
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el === null) return "none";
        return getComputedStyle(el).outlineStyle;
      });
    }, "focused nav link must have a non-none outline-style").not.toBe("none");

    // outline-color must be the brand focus-ring color #335A91. Browsers
    // serialize this as either "rgb(51, 90, 145)" (CSS Color 3, comma) or
    // "rgb(51 90 145)" (CSS Color 4, space) — tolerate both so the guard
    // survives a serialization change while still pinning token drift (a
    // transparent/wrong-color value fails the channel-equality check).
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? getComputedStyle(el).outlineColor : "";
      });
    }, "focused nav link outline-color must be brand --color-focus-ring (#335a91)").toContain(
      "51",
    );
    const outlineColor = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineColor : "";
    });
    expect(
      outlineColor.replace(/[\s,]/g, ""),
      "outline-color channels must equal #335a91 regardless of rgb serialization",
    ).toMatch(/51.*90.*145/);
  });

  test("/design 三态 ReactionChip 各含可见文字「涨」「跌」「平」(AC2 非颜色守卫)", async ({
    page,
  }) => {
    // `/design` is DB-free (static server component rendering token samples),
    // so this AC2 guard has zero DB/seed dependency.
    const response = await page.goto("/design");
    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);

    // The three ReactionChip tones pair a market color class with the CJK
    // text label (涨/跌/平). To prove AC2's "color is not the only signal"
    // we assert each label is VISIBLE INSIDE a market-colored chip element
    // — i.e. color and text coexist on the same node. A future color-only
    // variant (label removed or hidden) would fail here instead of silently
    // regressing AC2. Scoping to the market color class also proves the
    // label belongs to a reaction chip, not some unrelated node.
    await expect(
      page
        .locator('[class*="market-up-soft"]')
        .filter({ hasText: "涨" }),
      "涨 chip must carry market-up color AND visible 涨 text",
    ).toBeVisible();
    await expect(
      page
        .locator('[class*="market-down-soft"]')
        .filter({ hasText: "跌" }),
      "跌 chip must carry market-down color AND visible 跌 text",
    ).toBeVisible();
    await expect(
      page
        .locator('[class*="market-flat-soft"]')
        .filter({ hasText: "平" }),
      "平 chip must carry market-flat color AND visible 平 text",
    ).toBeVisible();
  });

  test("匿名访问 / 与 /design 均返回 200、无 /login 重定向 (AD-8)", async ({
    page,
  }) => {
    for (const href of ["/", "/design"]) {
      const response = await page.goto(href);
      expect(response, `${href} should respond`).not.toBeNull();
      expect(response!.status(), `${href} status should be 200`).toBe(200);
      expect(response!.url(), `${href} should not redirect to login`).not.toMatch(
        /\/login/,
      );
    }
  });
});
