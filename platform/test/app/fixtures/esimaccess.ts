/*
 * eSIM Access Open API answers, in their documented shape (docs.esimaccess.com, read 2026-10-17): the envelope
 * { success, errorCode, errorMsg, obj }, prices in USD × 10,000, volumes in bytes. Used by esimaccess.test.ts.
 */

export const GB = 1073741824;

export const PACKAGES_TR = {
  errorCode: null, errorMsg: null, success: true,
  obj: { packageList: [
    { packageCode: "CKH491", slug: "TR_1_7", name: "Turkey 1GB 7Days", price: 9000, currencyCode: "USD", volume: GB, smsStatus: 0, dataType: 1, unusedValidTime: 180, duration: 7, durationUnit: "DAY", location: "TR", locationCode: "TR", description: "Turkey 1GB 7Days", activeType: 2, favorite: false, retailPrice: 45000, speed: "3G/4G/5G", ipExport: "UK/NO", supportTopUpType: 2, fupPolicy: "", locationNetworkList: [{ locationName: "Turkey", locationLogo: "/img/flags/tr.png", locationCode: "TR", operatorList: [{ operatorName: "Turkcell", networkType: "5G" }] }] },
    { packageCode: "CKH493", slug: "TR_5_30", name: "Turkey 5GB 30Days", price: 31000, currencyCode: "USD", volume: 5 * GB, dataType: 1, duration: 30, durationUnit: "DAY", location: "TR", locationCode: "TR", retailPrice: 120000, supportTopUpType: 2, locationNetworkList: [{ locationName: "Turkey", locationCode: "TR", operatorList: [{ operatorName: "Turkcell", networkType: "5G" }] }] },
    { packageCode: "CKH495", slug: "TR_10_30", name: "Turkey 10GB 30Days", price: 52000, currencyCode: "USD", volume: 10 * GB, dataType: 1, duration: 30, durationUnit: "DAY", location: "TR", locationCode: "TR", retailPrice: 190000, supportTopUpType: 2, locationNetworkList: [{ locationName: "Turkey", locationCode: "TR", operatorList: [{ operatorName: "Vodafone", networkType: "4G" }] }] },
    { packageCode: "CKH500", slug: "TR_1_Daily", name: "Turkey 1GB/Day", price: 16000, currencyCode: "USD", volume: GB, dataType: 2, duration: 1, durationUnit: "DAY", location: "TR", locationCode: "TR", retailPrice: 60000, supportTopUpType: 3, locationNetworkList: [{ locationName: "Turkey", locationCode: "TR", operatorList: [{ operatorName: "Turkcell", networkType: "5G" }] }] },
  ] },
};

export const PACKAGES_EMPTY = { errorCode: null, errorMsg: null, success: true, obj: { packageList: [] } };

export const ORDER_OK = { errorCode: null, errorMsg: null, success: true, obj: { orderNo: "B26101716050537", transactionId: "x" } };
export const ALLOCATING = { success: false, errorCode: "200010", errorMsg: "Profile is being downloaded for the order.", obj: null };
export const LOW_BALANCE = { success: false, errorCode: "200007", errorMsg: "Insufficient account balance", obj: null };
export const BALANCE = { success: true, errorCode: "0", errorMsg: null, obj: { balance: 940000 } };

export const esimOf = (i: number, transactionId: string, orderNo = "B26101716050537") => ({
  esimTranNo: `2610171605000${i}`, orderNo, transactionId, imsi: "232104070313157", iccid: `894310817000313157${i}`, smsStatus: 1, msisdn: "4367844134157",
  ac: `LPA:1$rsp-eu.simlessly.com$B1CA5A707D30488AA84D670AADD1441${i}`, qrCodeUrl: "https://p.qrsim.net/76b8ee4943ab45778b6705c372134a6a.png", shortUrl: "https://p.qrsim.net/76b8ee4943ab45778b6705c372134a6a",
  smdpStatus: "RELEASED", eid: "", activeType: 2, dataType: 1, activateTime: null, expiredTime: "2026-12-16T14:21:37+0000", installationTime: null,
  totalVolume: 5 * GB, totalDuration: 30, durationUnit: "DAY", orderUsage: 0, esimStatus: "GOT_RESOURCE", pin: "7430", puk: "42110822", apn: "drei.at", ipExport: "UK/NO", supportTopUpType: 2, fupPolicy: "",
  packageList: [{ packageName: "Turkey 5GB 30Days", packageCode: "CKH493", slug: "TR_5_30", duration: 30, volume: 5 * GB, locationCode: "TR", createTime: "2026-10-17T14:06:10+0000" }],
});

export const query = (list: unknown[]) => ({ success: true, errorCode: "0", errorMsg: null, obj: { esimList: list, pager: { pageSize: 50, pageNum: 1, total: list.length } } });

export const hook = (type: string, content: Record<string, unknown>, id = `${type}-${Math.random().toString(36).slice(2)}`) => ({ notifyType: type, notifyId: id, eventGenerateTime: "2026-10-17T17:16:34Z", content });
