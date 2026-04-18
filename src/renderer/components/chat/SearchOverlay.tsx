/**
 * SearchOverlay — search bar overlay for filtering chat messages.
 *
 * Extracted from ChatView for reusability and clarity.
 */

import { useTranslation } from 'react-i18next';

export interface SearchOverlayProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  onClose: () => void;
}

export function SearchOverlay({
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  filteredCount,
  totalCount,
  onClose,
}: SearchOverlayProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="search-bar">
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        placeholder={t('chat.searchPlaceholder')}
      />
      <span className="search-bar-count">
        {searchQuery ? `${filteredCount}/${totalCount}` : ''}
      </span>
      <button
        onClick={onClose}
        className="btn-control btn-control--sm"
      >
        X
      </button>
    </div>
  );
}
