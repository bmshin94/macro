export type ChannelsTab = 'browse' | 'recents';

export type ChannelsGroup = 'favorites' | 'channels' | 'direct_messages';

export type ChannelsQueryScope =
  | Exclude<ChannelsGroup, 'favorites'>
  | 'recents';

export type ChannelsRailScope = ChannelsGroup | 'recents';

export type ChannelsMobileTab = ChannelsQueryScope;

export type ChannelsRailMode = 'auto' | 'full' | 'slim';

export type ChannelsViewState = {
  tab: ChannelsTab;
  mobileTab: ChannelsMobileTab;
  selectedChannelId?: string;
  expandedGroups: Record<ChannelsGroup, boolean>;
  asideWidth: number;
  railMode: ChannelsRailMode;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
};
