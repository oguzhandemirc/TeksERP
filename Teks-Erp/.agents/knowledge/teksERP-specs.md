Prizma Modelleri
// ============================================================================ 
// 1. DİNAMİK YETKİLENDİRME VE KULLANICI YÖNETİMİ (RBAC) 
// ============================================================================ 
model User { 
  id           String     @id @default(uuid()) 
  username     String     @unique 
  passwordHash String 
  fullName     String 
  isActive     Boolean    @default(true) 
  roles        UserRole[] // Bir kullanıcının birden fazla rolü olabilir 
  logs         SystemLog[] 
  createdAt    DateTime   @default(now()) 
  updatedAt    DateTime   @updatedAt 
} 
model Role { 
  id          String           @id @default(uuid()) 
  name        String           @unique // "Sevkiyatçı", "Planlama Şefi" 
  description String? 
  permissions RolePermission[] 
  users       UserRole[] 
} 
model Permission { 
  id          String           @id @default(uuid()) 
  code        String           @unique // Örn: "order:read", "order:write", 
"workorder:create" 
  module      String           // Örn: "SALES", "PRODUCTION", "FINANCE" 
  roles       RolePermission[] 
} 
model UserRole { 
  userId String 
  roleId String 
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade) 
  role   Role   @relation(fields: [roleId], references: [id], onDelete: Cascade) 
  @@id([userId, roleId]) 
} 
model RolePermission { 
  roleId       String 
  permissionId String 
  role         Role       @relation(fields: [roleId], references: [id], 
onDelete: Cascade) 
  permission   Permission @relation(fields: [permissionId], references: [id], 
onDelete: Cascade) 
  @@id([roleId, permissionId]) 
} 
// ============================================================================ 
// 2. TEMEL TANIMLAR (MASTER DATA) & İSTASYON/MAKİNE YÖNETİMİ 
// ============================================================================ 
// Yarın yeni bir istasyon (örneğin "Şardon") eklendiğinde kod yazmadan 
eklenebilmesi için. 
model Station { 
  id          String   @id @default(uuid()) 
  code        String   @unique // Örn: "BOYAHANE_DIS", "KURŞUN_1" 
  name        String 
  type        StationType // INTERNAL (İçeride), EXTERNAL (Fason) 
  department  String?  // DOKUMA, DEVERE, TERBİYE, SEVKİYAT vb. (Gelecek için) 
  machines    Machine[] 
  routeSteps  RouteStep[] 
  isActive    Boolean  @default(true) 
} 
model Machine { 
  // Sahadaki cihazları/tezgahları tanımlar (Tezgah-1, Tambur-2 vb.) 
  id          String   @id @default(uuid()) 
  stationId   String 
  station     Station  @relation(fields: [stationId], references: [id]) 
  code        String   @unique 
  name        String 
  deviceIp    String?  // COM portu, Kantar veya cihaz bağlantısı için 
  logs        MachineLog[] // Tezgah İzleme için 
} 
enum StationType { INTERNAL, EXTERNAL } 
model Route { 
  id          String   @id @default(uuid()) 
  name        String   // Örn: "Boyahane + Kurşun + Tambur" 
  steps       RouteStep[] 
} 
model RouteStep { 
  id          String   @id @default(uuid()) 
  routeId     String 
  route       Route    @relation(fields: [routeId], references: [id]) 
  stationId   String 
  station     Station  @relation(fields: [stationId], references: [id]) 
  sequence    Int      // Sıralama 
} 
// ============================================================================ 
// 3. ÜRÜN (STOK KARTI) VE ENVANTER 
// ============================================================================ 
// Sadece mamul kumaş değil; iplik, ham kumaş, yedek parça bile eklenebilir. 
model Item { // Eski 'Product'. Artık daha genel bir Stok Kartı. 
  id          String   @id @default(uuid()) 
  code        String   @unique 
  name        String 
  itemType    ItemType // YARN (İplik), RAW_FABRIC (Ham Kumaş), DYED_FABRIC 
(Mamul) vb. 
  unit        String   @default("MT") // MT, KG, ADET 
  rolls       Roll[] 
} 
enum ItemType { YARN, WARP, RAW_FABRIC, DYED_FABRIC, CONSUMABLE } 
model Roll { 
  id              String         @id @default(uuid()) 
  barcode         String         @unique 
  itemId          String 
  item            Item           @relation(fields: [itemId], references: [id]) 
  // Ölçümler 
  initialQty      Float          // İlk ölçüm (Metre) 
  currentQty      Float          // Kalan/Net miktar 
  weightKg        Float? 
  // Durum ve Kalite 
  status          RollStatus      
  qualityGrade    String          
  // Üretim Bağlantıları 
  producedInStepId String?        
  currentStepId    String?        
@default(STOCK) 
@default("1.KALITE") // 1.Kalite, A1, Fire 
// Hangi iş emri adımında üretildi/çıktı? 
// Şu an üretimde hangi adımda bekliyor? 
  packageId String?    
// Paket/Çuval barkod ID  
  grossWeightKg Float?    
  netWeightKg Float?    
packagingDate DateTime?   
  errors          RollError[] 
  allocations     OrderAllocation[] 
} 
enum RollStatus {  
  STOCK          // Ham stok 
// Tartıdan gelen brüt kilo  
// Sadece kumaş kilosu  
// Paketleme işleminin yapıldığı an 
  IN_PRODUCTION  // İstasyonlarda dolaşıyor 
  PRODUCED       // Tamburdan indi (Üretim bitti ama henüz paketlenmedi) 
  READY_FOR_SHIP // Paketlendi, tartıldı, çuvala girdi 
  SHIPPED        // Araca yüklendi, irsaliye kesildi 
  SCRAP          // Fire 
} 
// ============================================================================ 
// 4. SATIŞ, SİPARİŞ VE FİNANS (GENİŞLETİLMİŞ) 
// ============================================================================ 
model Customer { // İleride 'Company' yapılıp hem tedarikçi hem müşteri olabilir 
  id          String    @id @default(uuid()) 
  code        String    @unique 
  name        String 
  taxNumber   String? 
  type        CompanyType @default(CUSTOMER) // Fasoncular da buraya eklenebilir 
  orders      Order[] 
  accounts    CurrentAccount[] // Finans cari entegrasyonu için hazırlık 
} 
enum CompanyType { CUSTOMER, SUPPLIER, SUBCONTRACTOR } 
model Order { 
  id              String         @id @default(uuid()) 
  orderNumber     String         @unique 
  customerId      String 
  customer        Customer       @relation(fields: [customerId], references: 
[id]) 
  // Finans ve Fiyatlandırma Bağlantıları (Gelecek için esneklik) 
  currency        String         @default("TRY") 
  totalAmount     Decimal?       @db.Decimal(10, 2) 
  status          OrderStatus    @default(PENDING) 
  orderDate       DateTime       @default(now()) 
  deadline        DateTime? 
  lines           OrderLine[]    // Sipariş kalemleri (1 siparişte birden fazla 
desen/ürün olabilir) 
} 
model OrderLine { 
  id              String         @id @default(uuid()) 
  orderId         String 
  order           Order          @relation(fields: [orderId], references: [id]) 
  itemId          String 
  item            Item           @relation(fields: [itemId], references: [id]) 
  quantity        Float          // İstenen miktar 
  unitPrice       Decimal?       @db.Decimal(10, 2) // Gelecek finans modülü 
için 
  allocations     OrderAllocation[] 
  workOrderLinks  WorkOrderToOrderLine[]  
} 
enum OrderStatus { PENDING, APPROVED, IN_PRODUCTION, PARTIAL_SHIPPED, COMPLETED, 
CANCELLED } 
// ============================================================================ 
// 5. İŞ EMRİ (PARTİ) VE DİNAMİK ROTA YÖNETİMİ 
// ============================================================================ 
model WorkOrder { 
  id            String         @id @default(uuid()) 
  batchNumber   String         @unique // Parti Numarası 
  type          WorkOrderType  @default(FABRIC_DYEING) // DOKUMA, DEVERE, BOYAMA 
vb. 
  // Dinamik Parametreler (JSONB) - İstenilen en, reçete no gibi veriler esnek 
tutulur 
  parameters    Json?          // Örn: { "targetWidth": 150, "dyeRecipeCode": 
"R-123" } 
  status        WorkOrderStatus @default(PLANNED) 
  createdAt     DateTime       @default(now()) 
  steps         WorkOrderStep[] 
  orderLinks    WorkOrderToOrderLine[] 
} 
enum WorkOrderType { WEAVING, WARPING, FABRIC_DYEING, RE_PROCESS } 
enum WorkOrderStatus { PLANNED, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED } 
model WorkOrderStep { 
  // Rota ve Refakat Kartı Durakları 
  id            String   @id @default(uuid()) 
  workOrderId   String 
  workOrder     WorkOrder @relation(fields: [workOrderId], references: [id]) 
  stationId     String 
  station       Station   @relation(fields: [stationId], references: [id]) // 
Fason boyahane veya içerideki tambur 
  stepSequence  Int       // 1, 2, 3 (Rotadaki sırası) 
  status        StepStatus @default(PENDING) 
  // Her istasyonun kendine has özel verilerini tutmak için (JSON) 
  // Örn Tambur için: { "foldType": "4-kat" } 
  // Örn Kalite Kontrol için: { "operatorNote": "Hassas sarım yap" } 
  stepData      Json?      
  startedAt     DateTime? 
  completedAt   DateTime? 
} 
enum StepStatus { PENDING, ACTIVE, COMPLETED, SKIPPED } 
// İş Emri ve Sipariş Kalemi Arasındaki N:N İlişki 
model WorkOrderToOrderLine { 
  workOrderId   String 
  orderLineId   String 
  workOrder     WorkOrder @relation(fields: [workOrderId], references: [id]) 
  orderLine     OrderLine @relation(fields: [orderLineId], references: [id]) 
  @@id([workOrderId, orderLineId]) 
} 
// ============================================================================ 
// 6. ÜRETİM VERİLERİ (HATA VE FİRE) 
// ============================================================================ 
model RollError { 
  id            String   @id @default(uuid()) 
  rollId        String 
  roll          Roll     @relation(fields: [rollId], references: [id]) 
  startMeter    Float 
  endMeter      Float 
  errorType     String?  // Leke, Yırtık vb. (İleride hata kataloğu tablosuna 
bağlanabilir) 
  isProcessed   Boolean  @default(false) // Tamburda işleme alındı mı (Kesildi/
Kesilmedi)? 
  actionTaken   String?  // "CUT_FOR_SCRAP", "KEPT_AS_A1" vb. 
} 
// ============================================================================ 
// 7. LOJİSTİK VE PAYLAŞTIRMA 
// ============================================================================ 
model OrderAllocation { 
  // Hangi top, hangi siparişe, ne kadar rezerve edildi? 
  id            String   @id @default(uuid()) 
  orderLineId   String 
  orderLine     OrderLine @relation(fields: [orderLineId], references: [id]) 
  rollId        String 
  roll          Roll      @relation(fields: [rollId], references: [id]) 
  allocatedQty  Float 
} 
model Shipment { 
  id              String         @id @default(uuid()) 
  shipmentNumber  String         @unique // İrsaliye No veya Sevk No 
  customerId      String 
  customer        Customer       @relation(fields: [customerId], references: 
[id]) 
  driverName      String?        // Şoför adı 
  plateNumber     String?        // Araç plakası 
  carrier         String?        // Nakliye firması 
  status          ShipmentStatus @default(PREPARING) 
  shippedAt       DateTime?      // Gerçek çıkış saati 
  items           ShipmentItem[] // Bu sevkiyattaki ürünler 
  createdAt       DateTime       @default(now()) 
} 
model ShipmentItem { 
  id          String   @id @default(uuid()) 
  shipmentId  String 
  shipment    Shipment @relation(fields: [shipmentId], references: [id]) 
  rollId      String   @unique // Bir top aynı anda sadece bir sevkiyatta 
olabilir 
  roll        Roll     @relation(fields: [rollId], references: [id]) 
  // O anki sevkiyat metrajı/kilosu (Fatura için tarihsel kayıt) 
  shippedQty  Float 
  shippedWeight Float? 
} 
enum ShipmentStatus { PREPARING, SHIPPED, CANCELLED } 
// ============================================================================ 
// 8. GELECEĞE YATIRIM (FİNANS & MAKİNE LOGLARI PLATFORMLARI) 
// ============================================================================ 
model CurrentAccount { // Cari Hesap (Finans) 
  id          String    @id @default(uuid()) 
  customerId  String 
  customer    Customer  @relation(fields: [customerId], references: [id]) 
  balance     Decimal   @default(0.00) @db.Decimal(12, 2) 
  currency    String    @default("TRY") 
  // İleride Transaction/Invoice modelleri buraya bağlanır 
} 
model MachineLog { // Dokuma Tezgah İzleme (Ekstra Talep) 
  id          String   @id @default(uuid()) 
  machineId   String 
  machine     Machine  @relation(fields: [machineId], references: [id]) 
  logType     String   // "STATUS_UPDATE", "MAINTENANCE" 
  details     Json     // Örn: { "workingItemCode": "LINE_DESEN_1", "speed": 400 
} 
} 
  createdAt   DateTime @default(now()) 
model SystemLog { // Kullanıcı Denetim İzi (Audit Trail) 
  id          String   @id @default(uuid()) 
  userId      String 
  user        User     @relation(fields: [userId], references: [id]) 
  action      String 
  entityType  String   // "ORDER", "WORK_ORDER" 
  entityId    String 
  oldData     Json? 
  newData     Json? 
  createdAt   DateTime @default(now()) 
} 