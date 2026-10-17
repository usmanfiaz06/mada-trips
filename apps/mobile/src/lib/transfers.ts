import { useQuery } from '@tanstack/react-query';
import {
  CancelSupplierVoucherResponse, ChooseTransferResponse, HOTEL_ROUTES, HotelDetailsResponse, HotelTranslationResponse, SUPPLIER_VOUCHER_ROUTES, SupplierVoucherResponse, SupplierVouchersResponse,
  TRANSFER_ROUTES, TransferOptionsResponse, voucherHtml, type SupplierVoucher,
} from '@mada/shared';
import { request } from './api';
import { Platform, Share } from 'react-native';
import { useSession } from './session';

/*
 * Airport pickups, vouchers and hotel details (Hotelbeds): GET/POST /trips/{id}/transfers, /trips/{id}/vouchers,
 * /vouchers/{id} (+ /cancel, simulation first), /hotels/{code}. Every response is checked against the shared schema.
 */

export const transfersApi = {
  options: (tripId: string) => request({ method: 'GET', path: TRANSFER_ROUTES.transfers(tripId) }, TransferOptionsResponse),
  choose: (tripId: string, optionId: string, clientKey: string) => request({ method: 'POST', path: TRANSFER_ROUTES.transfers(tripId), body: { optionId, clientKey } }, ChooseTransferResponse),
  vouchers: (tripId: string) => request({ method: 'GET', path: SUPPLIER_VOUCHER_ROUTES.tripVouchers(tripId) }, SupplierVouchersResponse),
  voucher: (id: string) => request({ method: 'GET', path: SUPPLIER_VOUCHER_ROUTES.voucher(id) }, SupplierVoucherResponse),
  cancel: (id: string, confirm: boolean) => request({ method: 'POST', path: SUPPLIER_VOUCHER_ROUTES.cancel(id), body: { confirm } }, CancelSupplierVoucherResponse),
  hotel: (code: number) => request({ method: 'GET', path: HOTEL_ROUTES.hotel(code) }, HotelDetailsResponse),
  /** The hotel's own words in the reader's language, translated once on the server ("Translate"). */
  hotelTranslation: (code: number, to: 'en' | 'ar') => request({ method: 'GET', path: HOTEL_ROUTES.translation(code, to) }, HotelTranslationResponse),
};

const signedIn = () => !!useSession.getState().tokens;

export const transferKeys = {
  options: (tripId: string) => ['trips', 'transfers', tripId] as const,
  vouchers: (tripId: string) => ['trips', 'vouchers', tripId] as const,
  voucher: (id: string) => ['vouchers', id] as const,
  hotel: (code: number) => ['hotels', code] as const,
  translation: (code: number, to: string) => ['hotels', code, 'translation', to] as const,
};

export function useTransferOptions(tripId: string) {
  return useQuery({ queryKey: transferKeys.options(tripId), queryFn: () => transfersApi.options(tripId), enabled: !!tripId && signedIn(), staleTime: 5 * 60_000, retry: false });
}
export function useTripVouchers(tripId: string) {
  return useQuery({ queryKey: transferKeys.vouchers(tripId), queryFn: () => transfersApi.vouchers(tripId), enabled: !!tripId && signedIn(), staleTime: 60_000 });
}
export function useVoucher(id: string) {
  return useQuery({ queryKey: transferKeys.voucher(id), queryFn: () => transfersApi.voucher(id), enabled: !!id && signedIn() });
}
export function useHotelDetails(code: number) {
  // Open to anyone: a hotel page (shared or found while looking around) needs no account.
  return useQuery({ queryKey: transferKeys.hotel(code), queryFn: () => transfersApi.hotel(code), enabled: code > 0, staleTime: 24 * 3_600_000 });
}

/**
 * The voucher as a page to keep: on the web a download of the same printable HTML the server sends (print to PDF from
 * there); on a phone, the share sheet with the voucher's text.
 */
export async function saveVoucher(v: SupplierVoucher, lang: 'en' | 'ar') {
  const html = voucherHtml(v, lang);
  if (Platform.OS === 'web') {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voucher-${v.reference.replace(/[^A-Za-z0-9-]/g, '')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const text = [v.hotel?.name, v.hotel?.address, `${v.reference}`, v.checkIn && v.checkOut ? `${v.checkIn} → ${v.checkOut}` : null, v.room, v.board, v.holder, v.remarks, v.payableThrough].filter(Boolean).join('\n');
  await Share.share({ message: text });
}
