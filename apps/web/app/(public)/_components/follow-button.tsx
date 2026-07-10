"use client";

import { useTransition, useRef, useState, useId } from "react";

import type { FollowRef } from "@aguhot/core";

import { cn } from "@/lib/utils";

import { startSessionAndFollow, toggleFollow } from "../_actions/follow-actions";

/**
 * The two FollowRef kind literals. Inlined as plain strings so this client
 * component does NOT import the `@aguhot/core` runtime barrel (which drags the
 * Prisma client / `node:` modules into the client bundle). `FollowRef` is
 * imported as a TYPE only (erased at compile time).
 */
const HOT_EVENT = "hot_event" as const;
const THEME = "theme" as const;

/**
 * FollowButton — the deferred-login follow surface (Story 3.2).
 *
 * A single controlled client component used on three surfaces: the feed
 * EventCard (hot_event), the event detail page (hot_event), and the theme page
 * (theme). Initial state is server-rendered (SSR) from the page's read of the
 * follow state — no client state library, no optimistic mutations beyond a
 * pending-disable to prevent double-clicks. Toggling goes through server
 * actions (toggleFollow for logged-in, startSessionAndFollow for anonymous),
 * which revalidate the relevant paths so the new state reflects on every page
 * that reads it (AC2 cross-page consistency).
 *
 * Deferred-login UX (AC1 + AC3):
 *   - Anonymous click → open the native `<dialog>` (showModal) with the honest
 *     "登录以保存收藏" prompt. 「登录并收藏」 creates an account + sets the
 *     signed cookie + writes the follow (startSessionAndFollow). 「取消」 / ESC
 *     closes the dialog and the reader continues browsing anonymously (no
 *     follow written, no page break). The native `<dialog>` provides a focus
 *     trap + ESC-to-close + focus restore for free (zero a11y dependency).
 *   - Logged-in click → toggleFollow (follow if not following, unfollow if
 *     following).
 *
 * a11y: the main button carries `aria-pressed` reflecting the follow state and
 * a descriptive `aria-label`. The dialog uses `aria-labelledby` +
 * `aria-describedby` pointing at its title + body copy. Touch targets are
 * `min-h-11` (44px), matching the SearchBox convention.
 *
 * HTML validity: FollowButton is rendered as a DOM SIBLING of the whole-card
 * `<Link>` inside `<li class="relative">` (see event-card.tsx) — NEVER nested
 * inside the `<a>`. Nesting a `<button>`/`<form>` inside an `<a>` is invalid
 * HTML and breaks both interactions.
 */

export interface FollowButtonProps {
  /** The target ref (discriminated union). Drives the form hidden fields. */
  followRef: FollowRef;
  /** SSR initial follow state (read by the page). */
  initialIsFollowing: boolean;
  /** SSR initial logged-in state (session present). */
  isLoggedIn: boolean;
  /** Optional extra classes on the outer wrapper. */
  className?: string;
}

export function FollowButton({
  followRef,
  initialIsFollowing,
  isLoggedIn,
  className,
}: FollowButtonProps) {
  // Mirror the server-rendered props in state. useState initializes once per
  // mount, so after startSessionAndFollow flips the user to logged-in +
  // following we update state directly (see handleStartSessionAndFollow).
  //
  // When a revalidatePath-driven re-render delivers NEW prop values (e.g. the
  // follow state changed on another surface, or the isLoggedIn prop finally
  // catches up after a login), the state is re-synced to the props during
  // render using the canonical "adjusting state when props change" pattern
  // (react.dev/reference/react/useState#storing-information-from-previous-renders).
  // This converges state WITHOUT a useEffect, so a second click on the same
  // mount never reopens the login dialog for an already-logged-in follower,
  // and we avoid the cascading-render lint violation a setState-in-effect
  // would trigger.
  const [isFollowing, setIsFollowing] = useState<boolean>(initialIsFollowing);
  const [loggedIn, setLoggedIn] = useState<boolean>(isLoggedIn);
  const [prevInitialIsFollowing, setPrevInitialIsFollowing] = useState(initialIsFollowing);
  const [prevIsLoggedIn, setPrevIsLoggedIn] = useState(isLoggedIn);
  if (initialIsFollowing !== prevInitialIsFollowing) {
    setPrevInitialIsFollowing(initialIsFollowing);
    setIsFollowing(initialIsFollowing);
  }
  if (isLoggedIn !== prevIsLoggedIn) {
    setPrevIsLoggedIn(isLoggedIn);
    setLoggedIn(isLoggedIn);
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Stable, unique ids for dialog aria-labelledby / aria-describedby. useId is
  // SSR-safe (no hydration mismatch) and id-free at the call site.
  const titleId = useId();
  const descId = useId();

  const targetKind = followRef.kind === HOT_EVENT ? HOT_EVENT : THEME;
  const targetId = followRef.kind === HOT_EVENT ? followRef.hotEventId : followRef.themeSlug;

  /**
   * Logged-in toggle. Wraps the server action in startTransition so the button
   * can be disabled optimistically (prevent double-click). On success the
   * revalidatePath inside the action triggers a server re-render and the SSR
   * initial state catches up on the next navigation.
   */
  function handleToggle() {
    setError(null);
    const formData = new FormData();
    formData.set("targetKind", targetKind);
    formData.set("targetId", targetId);
    startTransition(async () => {
      try {
        const result = await toggleFollow(formData);
        setIsFollowing(result.following);
      } catch (err) {
        setError(err instanceof Error ? err.message : "操作失败，请稍后重试。");
      }
    });
  }

  /**
   * Anonymous→logged-in follow (the "login action"). Creates an account, sets
   * the session cookie, writes the follow. On success the button flips to
   * 「已收藏」 and the dialog closes.
   */
  function handleStartSessionAndFollow() {
    setError(null);
    const formData = new FormData();
    formData.set("targetKind", targetKind);
    formData.set("targetId", targetId);
    startTransition(async () => {
      try {
        await startSessionAndFollow(formData);
        // The cookie is now set + the follow row written. Update local state so
        // a second click on this same mount routes through the logged-in toggle
        // path instead of reopening the login dialog (the isLoggedIn prop only
        // catches up after a navigation/revalidate re-render).
        setLoggedIn(true);
        setIsFollowing(true);
        dialogRef.current?.close();
      } catch (err) {
        setError(err instanceof Error ? err.message : "登录失败，请稍后重试。");
      }
    });
  }

  function handleAnonymousClick() {
    // Open the native <dialog>. showModal() provides the focus trap + ESC
    // close + focus restore for free (no a11y dependency).
    dialogRef.current?.showModal();
  }

  function handleCancel() {
    dialogRef.current?.close();
  }

  function onButtonClick() {
    if (loggedIn) {
      handleToggle();
    } else {
      handleAnonymousClick();
    }
  }

  const label = isFollowing ? "已收藏" : "收藏";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={onButtonClick}
        disabled={pending}
        aria-pressed={isFollowing}
        aria-label={`${label}：${targetKind === HOT_EVENT ? "热点事件" : "主题"}`}
        className={cn(
          "min-h-11 rounded-full border px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isFollowing
            ? "border-border-hairline bg-surface-raised text-ink-secondary"
            : "border-transparent bg-brand px-3 text-brand-foreground hover:opacity-90",
        )}
      >
        {label}
      </button>

      {/*
        Outer error region. The dialog's own error copy is only visible while
        the dialog is open (the anonymous login path); a logged-in user whose
        toggleFollow throws never opens the dialog, so without this sibling
        region the error would be hidden in a closed dialog. When the dialog IS
        open its backdrop covers this region, so the message is never visually
        doubled.
      */}
      {error !== null ? (
        <p role="alert" className="text-sm text-ink-secondary">
          {error}
        </p>
      ) : null}

      {/*
        Native <dialog> for the deferred-login prompt. showModal() gives a
        top-layer modal with focus trap + ESC close + focus restore. The two
        buttons are real <button> elements (keyboard + touch reachable).
        aria-labelledby + aria-describedby name + describe the dialog.
      */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={cn(
          "rounded-lg border border-border-hairline bg-surface-raised p-6 text-ink-primary",
          // The native ::backdrop is darkened by the UA; keep our layer minimal.
          "backdrop:bg-black/40",
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          登录以保存收藏
        </h2>
        <p id={descId} className="mt-2 text-sm text-ink-secondary">
          我们将为你创建一个轻量会话（无需账号密码）。登录后即可在多个页面同步你的收藏。
        </p>

        {error !== null ? (
          <p role="alert" className="mt-3 text-sm text-ink-secondary">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/*
            「登录并收藏」 submits startSessionAndFollow. It is a plain button
            (no form) — the action is invoked directly so the dialog stays open
            during the transition and closes on success. The min-h-11 touch
            target matches the SearchBox convention.
          */}
          <button
            type="button"
            onClick={handleStartSessionAndFollow}
            disabled={pending}
            className={cn(
              "min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:opacity-90",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {pending ? "处理中…" : "登录并收藏"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className={cn(
              "min-h-11 rounded-md border border-border-hairline bg-surface-raised px-4 text-sm font-medium text-ink-secondary hover:bg-surface-muted",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            取消
          </button>
        </div>
      </dialog>
    </div>
  );
}
