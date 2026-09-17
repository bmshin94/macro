import { createContext, type ParentComponent, useContext } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { PDFViewer } from '../PdfViewer';

type PageViewportWithScale = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pageHeight: number;
  pageWidth: number;
  /** zoomed scale from PDF units to CSS units (ratio from view size pixels to PDF units) */
  viewScale: number;
  /** scale from zoom */
  relativeScale: number;
};
const PAGE_VIEWPORT_DEFAULT: PageViewportWithScale = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
  viewScale: 0,
  relativeScale: 0,
  pageHeight: 0,
  pageWidth: 0,
};

export const initializePdfViewer = (popupViewer?: PDFViewer) => {
  return new PDFViewer(popupViewer);
};

export const useGetRootViewer = () => {
  return usePdfDocument().viewer.root.instance;
};

export const useGetPopupViewer = () => {
  return usePdfDocument().viewer.popup.instance;
};

export const useGetPopupContextViewer = () => {
  const getRootViewer = useGetRootViewer();
  const getPopupViewer = useGetPopupViewer();
  const isPopup = useIsPopup();
  return () => (isPopup ? getPopupViewer() : getRootViewer());
};

// NOTE: this fires off on every change because the isEqual function is not working
export const useVisiblePages = () => {
  const viewer = usePdfDocument().viewer;
  const isPopup = useIsPopup();
  const viewArea = isPopup ? viewer.popup.viewArea : viewer.root.viewArea;
  return () => viewArea()?.visiblePages;
};

const PopupContext = createContext<boolean>();
export const ViewerPopupProvider: ParentComponent<{ isPopup?: boolean }> = (
  props
) => (
  <PopupContext.Provider value={props.isPopup ?? false}>
    {props.children}
  </PopupContext.Provider>
);
export function useIsPopup() {
  const context = useContext(PopupContext);
  if (context === undefined) {
    throw new Error('useIsPopup: cannot find a ViewerPopupProvider');
  }

  return context;
}

export const useOverlayViewsChanged = () => {
  const viewer = usePdfDocument().viewer;
  const isPopup = useIsPopup();
  return isPopup ? viewer.popup.overlayViews : viewer.root.overlayViews;
};

export const useCurrentPageNumber = () => {
  return usePdfDocument().viewer.root.currentPageNumber;
};

// /** reactive values based on current page dimensions */
export const useCurrentPageViewport = () => {
  const pdf = usePdfDocument();
  const isPopup = useIsPopup();
  const getViewer = useGetPopupContextViewer();
  const currentPageNumber = isPopup
    ? pdf.viewer.popup.currentPageNumber
    : pdf.viewer.root.currentPageNumber;

  return () => {
    const curPage = currentPageNumber();
    const viewer = getViewer();
    if (!pdf.viewer.root.isReady() || !viewer || curPage < 1)
      return PAGE_VIEWPORT_DEFAULT;
    return viewer.pageViewport(curPage - 1) ?? PAGE_VIEWPORT_DEFAULT;
  };
};

export const useCurrentScale = () => {
  const viewer = usePdfDocument().viewer;
  const isPopup = useIsPopup();
  const currentScale = isPopup
    ? viewer.popup.currentScale
    : viewer.root.currentScale;
  return () => currentScale() ?? 1;
};
