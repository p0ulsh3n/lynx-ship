import { useEffect, useMemo, useState, type ReactNode } from "@lynx-js/react";

import {
  ActivityStack,
  type ActivityStackItem,
  type ActivityStackOptions,
  type ActivityStackSnapshot,
} from "./activity-stack.js";
import "./react-lynx-banners.css";

export const DEFAULT_LIVE_RING_COLOR = "#ff3b81";

export interface ActivityBannerItem extends ActivityStackItem {
  title: string;
  body: string;
  avatarUrl?: string;
  /** Adds a pulsing ring around the avatar while the user is live. */
  isLive?: boolean;
  /** Per-live-banner ring color. Any Lynx-supported color value is accepted. */
  liveRingColor?: string;
  /** Per-live-banner ring thickness in logical pixels. */
  liveRingWidth?: number;
}

export interface UseActivityStackResult<T extends ActivityStackItem> {
  stack: ActivityStack<T>;
  snapshot: ActivityStackSnapshot<T>;
}

/**
 * ReactLynx hook for connecting the headless stack to a component render.
 * Keep the options object stable: the stack is intentionally created once so
 * its timers and retained items survive ordinary React renders.
 */
export function useActivityStack<T extends ActivityStackItem>(
  options: Omit<ActivityStackOptions<T>, "onChange"> = {},
): UseActivityStackResult<T> {
  const [snapshot, setSnapshot] = useState<ActivityStackSnapshot<T>>({
    visible: [],
    overflowCount: 0,
    totalCount: 0,
  });
  const stack = useMemo(
    () => new ActivityStack<T>({ ...options, onChange: setSnapshot }),
    [],
  );

  useEffect(() => () => stack.destroy(), [stack]);

  return { stack, snapshot };
}

export interface ActivityBannerLayerProps<
  T extends ActivityBannerItem = ActivityBannerItem,
> {
  snapshot: ActivityStackSnapshot<T>;
  onPress?: (item: T) => void;
  /** Override the default Lynx class name with the app's own class. */
  className?: string;
  /** Safe-area inset supplied by the host; 16 is a safe fallback. */
  topInset?: number;
  /** Horizontal inset from the screen edges; 16 is the default. */
  horizontalInset?: number;
  /** Override the default visual theme without replacing the component. */
  theme?: ActivityBannerTheme;
  /** Use application/Tailwind classes as the complete visual implementation. */
  classNames?: ActivityBannerClassNames;
  /** Remove default inline layout/visual styles so classes control the design. */
  unstyled?: boolean;
}

/**
 * Inline Lynx styles accepted by the standard banner layer. Use this for
 * colors and spacing that belong to the application design system.
 */
export type ActivityBannerStyle = Record<string, string | number | undefined>;

export interface ActivityBannerTheme {
  layer?: ActivityBannerStyle;
  card?: ActivityBannerStyle;
  avatarSlot?: ActivityBannerStyle;
  avatar?: ActivityBannerStyle;
  avatarPlaceholder?: ActivityBannerStyle;
  liveRing?: ActivityBannerStyle;
  content?: ActivityBannerStyle;
  title?: ActivityBannerStyle;
  body?: ActivityBannerStyle;
}

/** Tailwind/CSS class hooks for each rendered banner part. */
export interface ActivityBannerClassNames {
  layer?: string;
  card?: string;
  avatarSlot?: string;
  avatar?: string;
  avatarPlaceholder?: string;
  liveRing?: string;
  content?: string;
  title?: string;
  body?: string;
}

const layerStyle = {
  position: "fixed",
  top: 16,
  left: 16,
  right: 16,
  zIndex: 1000,
} as const;

const cardStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  minHeight: 68,
  padding: 12,
  display: "linear",
  linearDirection: "row",
  alignItems: "center",
  backgroundColor: "#18283d",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#2d5874",
  borderRadius: 18,
  boxSizing: "border-box",
} as const;

const avatarStyle = {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: "#304965",
} as const;

const avatarSlotStyle = {
  marginRight: 12,
} as const;

const liveRingStyle = {
  width: 54,
  height: 54,
  borderRadius: 27,
  borderWidth: 2,
  borderStyle: "solid",
  padding: 3,
  display: "linear",
  justifyContent: "center",
  alignItems: "center",
  boxSizing: "border-box",
} as const;

const contentStyle = {
  linearWeight: 1,
  minWidth: 0,
} as const;

const titleStyle = {
  color: "#ffffff",
  fontSize: 15,
  fontWeight: "600",
} as const;

const bodyStyle = {
  marginTop: 4,
  color: "#b7c9d9",
  fontSize: 13,
} as const;

function initials(title: string): string {
  return title
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function normalizedLiveRingColor(color: string | undefined): string {
  const value = color?.trim();
  return value || DEFAULT_LIVE_RING_COLOR;
}

function normalizedLiveRingWidth(width: number | undefined): number {
  return width !== undefined && Number.isFinite(width) && width >= 0
    ? width
    : 2;
}

function mergeClassName(base: string, custom: string | undefined): string {
  return custom ? `${base} ${custom}` : base;
}

function renderAvatar(
  item: ActivityBannerItem,
  theme: ActivityBannerTheme,
  classNames: ActivityBannerClassNames,
  unstyled: boolean,
): ReactNode {
  const avatar = item.avatarUrl ? (
    <image
      className={mergeClassName(
        "lynxship-activity-banner-avatar",
        classNames.avatar,
      )}
      style={unstyled ? theme.avatar : { ...avatarStyle, ...theme.avatar }}
      src={item.avatarUrl}
    />
  ) : (
    <view
      className={mergeClassName(
        "lynxship-activity-banner-avatar-placeholder",
        classNames.avatarPlaceholder ?? classNames.avatar,
      )}
      style={
        {
          ...(unstyled ? {} : avatarStyle),
          ...(unstyled
            ? {}
            : {
                display: "linear",
                justifyContent: "center",
                alignItems: "center",
              }),
          ...theme.avatar,
          ...theme.avatarPlaceholder,
        } as const
      }
    >
      <text style={{ color: "#ffffff", fontSize: 14 }}>
        {initials(item.title)}
      </text>
    </view>
  );

  return (
    <view
      className={mergeClassName(
        "lynxship-activity-banner-avatar-slot",
        classNames.avatarSlot,
      )}
      style={
        unstyled
          ? theme.avatarSlot
          : { ...avatarSlotStyle, ...theme.avatarSlot }
      }
    >
      {item.isLive ? (
        <view
          className={mergeClassName(
            "lynxship-activity-banner-live-ring",
            classNames.liveRing,
          )}
          style={{
            ...(unstyled ? {} : liveRingStyle),
            ...theme.liveRing,
            borderColor: normalizedLiveRingColor(item.liveRingColor),
            borderWidth: normalizedLiveRingWidth(item.liveRingWidth),
          }}
        >
          {avatar}
        </view>
      ) : (
        avatar
      )}
    </view>
  );
}

/**
 * Ready-to-use in-app banner layer for ReactLynx.
 *
 * The avatar is always the first child on the left. There is deliberately no
 * application logo: system notifications and in-app banners have different
 * responsibilities. Apps can replace the class name and use the snapshot
 * directly when they need a completely custom visual treatment.
 */
export function ActivityBannerLayer<
  T extends ActivityBannerItem = ActivityBannerItem,
>({
  snapshot,
  onPress,
  className = "lynxship-activity-banner-layer",
  topInset = 16,
  horizontalInset = 16,
  theme = {},
  classNames = {},
  unstyled = false,
}: ActivityBannerLayerProps<T>): ReactNode {
  return (
    <view
      className={mergeClassName(className, classNames.layer)}
      style={{
        ...(unstyled ? {} : layerStyle),
        ...theme.layer,
        ...(unstyled
          ? {}
          : { top: topInset, left: horizontalInset, right: horizontalInset }),
      }}
    >
      {snapshot.visible.map((entry) => (
        <view
          key={entry.key}
          className={mergeClassName(
            "lynxship-activity-banner",
            classNames.card,
          )}
          style={{
            ...(unstyled ? {} : cardStyle),
            ...theme.card,
            top: entry.offsetY,
            zIndex: entry.zIndex,
            opacity: entry.opacity,
            transform: `scale(${entry.scale})`,
          }}
          bindtap={() => onPress?.(entry.item)}
        >
          {renderAvatar(entry.item, theme, classNames, unstyled)}
          <view
            className={mergeClassName(
              "lynxship-activity-banner-content",
              classNames.content,
            )}
            style={
              unstyled ? theme.content : { ...contentStyle, ...theme.content }
            }
          >
            <text
              className={mergeClassName(
                "lynxship-activity-banner-title",
                classNames.title,
              )}
              style={unstyled ? theme.title : { ...titleStyle, ...theme.title }}
            >
              {entry.item.title}
            </text>
            <text
              className={mergeClassName(
                "lynxship-activity-banner-body",
                classNames.body,
              )}
              style={unstyled ? theme.body : { ...bodyStyle, ...theme.body }}
            >
              {entry.item.body}
            </text>
          </view>
        </view>
      ))}
    </view>
  );
}
