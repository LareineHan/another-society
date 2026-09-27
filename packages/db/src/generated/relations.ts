import { relations } from "drizzle-orm/relations";
import { users, authIdentities, authSessions, worlds, regions, cities, districts, chunks, plots, roadNodes, plotReservations, roadEdges, residents, companionMinis, properties, spaces, itemDefinitions, itemInstances, placements, presence, stays, visitReceipts, gifts, reports, moderationActions, wallets, ledgerTransactions, ledgerEntries, storeListings, marketListings, procurementOrders, procurementSubmissions, civicAnchors, deletionRequests, worldTemplateImports, blocks, materialBalances, propertyVisitDaily, cityActivationBundles, idempotencyKeys } from "./schema";

export const authIdentitiesRelations = relations(authIdentities, ({one}) => ({
	user: one(users, {
		fields: [authIdentities.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	authIdentities: many(authIdentities),
	authSessions: many(authSessions),
	plotReservations: many(plotReservations),
	residents: many(residents),
	deletionRequests: many(deletionRequests),
	idempotencyKeys: many(idempotencyKeys),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	user: one(users, {
		fields: [authSessions.userId],
		references: [users.id]
	}),
}));

export const regionsRelations = relations(regions, ({one, many}) => ({
	world: one(worlds, {
		fields: [regions.worldId],
		references: [worlds.id]
	}),
	cities: many(cities),
}));

export const worldsRelations = relations(worlds, ({many}) => ({
	regions: many(regions),
	residents: many(residents),
}));

export const citiesRelations = relations(cities, ({one, many}) => ({
	region: one(regions, {
		fields: [cities.regionId],
		references: [regions.id]
	}),
	districts: many(districts),
	chunks: many(chunks),
	plots: many(plots),
	roadNodes: many(roadNodes),
	roadEdges: many(roadEdges),
	itemInstances: many(itemInstances),
	presences: many(presence),
	wallets: many(wallets),
	storeListings: many(storeListings),
	procurementOrders: many(procurementOrders),
	civicAnchors: many(civicAnchors),
	worldTemplateImports: many(worldTemplateImports),
	cityActivationBundles: many(cityActivationBundles),
}));

export const districtsRelations = relations(districts, ({one, many}) => ({
	city: one(cities, {
		fields: [districts.cityId],
		references: [cities.id]
	}),
	chunks: many(chunks),
	plots: many(plots),
	roadNodes: many(roadNodes),
	roadEdges: many(roadEdges),
}));

export const chunksRelations = relations(chunks, ({one, many}) => ({
	city: one(cities, {
		fields: [chunks.cityId],
		references: [cities.id]
	}),
	district: one(districts, {
		fields: [chunks.districtId],
		references: [districts.id]
	}),
	plots: many(plots),
}));

export const plotsRelations = relations(plots, ({one, many}) => ({
	chunk: one(chunks, {
		fields: [plots.chunkId],
		references: [chunks.id]
	}),
	city: one(cities, {
		fields: [plots.cityId],
		references: [cities.id]
	}),
	district: one(districts, {
		fields: [plots.districtId],
		references: [districts.id]
	}),
	roadNode: one(roadNodes, {
		fields: [plots.frontageNodeId],
		references: [roadNodes.id]
	}),
	plotReservations: many(plotReservations),
	properties: many(properties),
}));

export const roadNodesRelations = relations(roadNodes, ({one, many}) => ({
	plots: many(plots),
	city: one(cities, {
		fields: [roadNodes.cityId],
		references: [cities.id]
	}),
	district: one(districts, {
		fields: [roadNodes.districtId],
		references: [districts.id]
	}),
	roadEdges_fromNodeId: many(roadEdges, {
		relationName: "roadEdges_fromNodeId_roadNodes_id"
	}),
	roadEdges_toNodeId: many(roadEdges, {
		relationName: "roadEdges_toNodeId_roadNodes_id"
	}),
	civicAnchors: many(civicAnchors),
}));

export const plotReservationsRelations = relations(plotReservations, ({one}) => ({
	plot: one(plots, {
		fields: [plotReservations.plotId],
		references: [plots.id]
	}),
	user: one(users, {
		fields: [plotReservations.userId],
		references: [users.id]
	}),
}));

export const roadEdgesRelations = relations(roadEdges, ({one}) => ({
	city: one(cities, {
		fields: [roadEdges.cityId],
		references: [cities.id]
	}),
	district: one(districts, {
		fields: [roadEdges.districtId],
		references: [districts.id]
	}),
	roadNode_fromNodeId: one(roadNodes, {
		fields: [roadEdges.fromNodeId],
		references: [roadNodes.id],
		relationName: "roadEdges_fromNodeId_roadNodes_id"
	}),
	roadNode_toNodeId: one(roadNodes, {
		fields: [roadEdges.toNodeId],
		references: [roadNodes.id],
		relationName: "roadEdges_toNodeId_roadNodes_id"
	}),
}));

export const residentsRelations = relations(residents, ({one, many}) => ({
	user: one(users, {
		fields: [residents.userId],
		references: [users.id]
	}),
	world: one(worlds, {
		fields: [residents.worldId],
		references: [worlds.id]
	}),
	companionMinis: many(companionMinis),
	properties: many(properties),
	itemDefinitions: many(itemDefinitions),
	itemInstances: many(itemInstances),
	presences: many(presence),
	stays: many(stays),
	visitReceipts: many(visitReceipts),
	gifts_giverResidentId: many(gifts, {
		relationName: "gifts_giverResidentId_residents_id"
	}),
	gifts_recipientResidentId: many(gifts, {
		relationName: "gifts_recipientResidentId_residents_id"
	}),
	reports: many(reports),
	wallets: many(wallets),
	ledgerTransactions: many(ledgerTransactions),
	marketListings: many(marketListings),
	procurementSubmissions: many(procurementSubmissions),
	blocks_blockedResidentId: many(blocks, {
		relationName: "blocks_blockedResidentId_residents_id"
	}),
	blocks_blockerResidentId: many(blocks, {
		relationName: "blocks_blockerResidentId_residents_id"
	}),
	materialBalances: many(materialBalances),
}));

export const companionMinisRelations = relations(companionMinis, ({one}) => ({
	resident: one(residents, {
		fields: [companionMinis.ownerResidentId],
		references: [residents.id]
	}),
}));

export const propertiesRelations = relations(properties, ({one, many}) => ({
	resident: one(residents, {
		fields: [properties.ownerResidentId],
		references: [residents.id]
	}),
	plot: one(plots, {
		fields: [properties.plotId],
		references: [plots.id]
	}),
	spaces: many(spaces),
	presences: many(presence),
	stays: many(stays),
	visitReceipts: many(visitReceipts),
	gifts: many(gifts),
	propertyVisitDailies: many(propertyVisitDaily),
}));

export const spacesRelations = relations(spaces, ({one, many}) => ({
	property: one(properties, {
		fields: [spaces.propertyId],
		references: [properties.id]
	}),
	placements: many(placements),
	presences: many(presence),
	stays: many(stays),
	gifts: many(gifts),
}));

export const itemDefinitionsRelations = relations(itemDefinitions, ({one, many}) => ({
	resident: one(residents, {
		fields: [itemDefinitions.creatorResidentId],
		references: [residents.id]
	}),
	itemInstances: many(itemInstances),
	storeListings: many(storeListings),
}));

export const itemInstancesRelations = relations(itemInstances, ({one, many}) => ({
	itemDefinition: one(itemDefinitions, {
		fields: [itemInstances.definitionId],
		references: [itemDefinitions.id]
	}),
	city: one(cities, {
		fields: [itemInstances.ownerCityId],
		references: [cities.id]
	}),
	resident: one(residents, {
		fields: [itemInstances.ownerResidentId],
		references: [residents.id]
	}),
	placements: many(placements),
	gifts: many(gifts),
	storeListings: many(storeListings),
	marketListings: many(marketListings),
	procurementSubmissions: many(procurementSubmissions),
}));

export const placementsRelations = relations(placements, ({one}) => ({
	itemInstance: one(itemInstances, {
		fields: [placements.itemInstanceId],
		references: [itemInstances.id]
	}),
	space: one(spaces, {
		fields: [placements.spaceId],
		references: [spaces.id]
	}),
}));

export const presenceRelations = relations(presence, ({one}) => ({
	city: one(cities, {
		fields: [presence.currentCityId],
		references: [cities.id]
	}),
	property: one(properties, {
		fields: [presence.currentPropertyId],
		references: [properties.id]
	}),
	space: one(spaces, {
		fields: [presence.currentSpaceId],
		references: [spaces.id]
	}),
	resident: one(residents, {
		fields: [presence.residentId],
		references: [residents.id]
	}),
}));

export const staysRelations = relations(stays, ({one}) => ({
	property: one(properties, {
		fields: [stays.hostPropertyId],
		references: [properties.id]
	}),
	resident: one(residents, {
		fields: [stays.residentId],
		references: [residents.id]
	}),
	space: one(spaces, {
		fields: [stays.spaceId],
		references: [spaces.id]
	}),
}));

export const visitReceiptsRelations = relations(visitReceipts, ({one}) => ({
	property: one(properties, {
		fields: [visitReceipts.propertyId],
		references: [properties.id]
	}),
	resident: one(residents, {
		fields: [visitReceipts.visitorResidentId],
		references: [residents.id]
	}),
}));

export const giftsRelations = relations(gifts, ({one}) => ({
	resident_giverResidentId: one(residents, {
		fields: [gifts.giverResidentId],
		references: [residents.id],
		relationName: "gifts_giverResidentId_residents_id"
	}),
	itemInstance: one(itemInstances, {
		fields: [gifts.itemInstanceId],
		references: [itemInstances.id]
	}),
	property: one(properties, {
		fields: [gifts.propertyId],
		references: [properties.id]
	}),
	resident_recipientResidentId: one(residents, {
		fields: [gifts.recipientResidentId],
		references: [residents.id],
		relationName: "gifts_recipientResidentId_residents_id"
	}),
	space: one(spaces, {
		fields: [gifts.spaceId],
		references: [spaces.id]
	}),
}));

export const reportsRelations = relations(reports, ({one, many}) => ({
	resident: one(residents, {
		fields: [reports.reporterResidentId],
		references: [residents.id]
	}),
	moderationActions: many(moderationActions),
}));

export const moderationActionsRelations = relations(moderationActions, ({one}) => ({
	report: one(reports, {
		fields: [moderationActions.reportId],
		references: [reports.id]
	}),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	city: one(cities, {
		fields: [wallets.cityId],
		references: [cities.id]
	}),
	resident: one(residents, {
		fields: [wallets.residentId],
		references: [residents.id]
	}),
	ledgerEntries: many(ledgerEntries),
	storeListings: many(storeListings),
	marketListings: many(marketListings),
	procurementOrders: many(procurementOrders),
}));

export const ledgerTransactionsRelations = relations(ledgerTransactions, ({one, many}) => ({
	resident: one(residents, {
		fields: [ledgerTransactions.actorResidentId],
		references: [residents.id]
	}),
	ledgerEntries: many(ledgerEntries),
	procurementSubmissions: many(procurementSubmissions),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({one}) => ({
	ledgerTransaction: one(ledgerTransactions, {
		fields: [ledgerEntries.transactionId],
		references: [ledgerTransactions.id]
	}),
	wallet: one(wallets, {
		fields: [ledgerEntries.walletId],
		references: [wallets.id]
	}),
}));

export const storeListingsRelations = relations(storeListings, ({one}) => ({
	city: one(cities, {
		fields: [storeListings.cityId],
		references: [cities.id]
	}),
	itemDefinition: one(itemDefinitions, {
		fields: [storeListings.itemDefinitionId],
		references: [itemDefinitions.id]
	}),
	itemInstance: one(itemInstances, {
		fields: [storeListings.itemInstanceId],
		references: [itemInstances.id]
	}),
	wallet: one(wallets, {
		fields: [storeListings.sellerWalletId],
		references: [wallets.id]
	}),
}));

export const marketListingsRelations = relations(marketListings, ({one}) => ({
	itemInstance: one(itemInstances, {
		fields: [marketListings.itemInstanceId],
		references: [itemInstances.id]
	}),
	resident: one(residents, {
		fields: [marketListings.sellerResidentId],
		references: [residents.id]
	}),
	wallet: one(wallets, {
		fields: [marketListings.sellerWalletId],
		references: [wallets.id]
	}),
}));

export const procurementOrdersRelations = relations(procurementOrders, ({one, many}) => ({
	city: one(cities, {
		fields: [procurementOrders.cityId],
		references: [cities.id]
	}),
	wallet: one(wallets, {
		fields: [procurementOrders.cityWalletId],
		references: [wallets.id]
	}),
	procurementSubmissions: many(procurementSubmissions),
}));

export const procurementSubmissionsRelations = relations(procurementSubmissions, ({one}) => ({
	resident: one(residents, {
		fields: [procurementSubmissions.creatorResidentId],
		references: [residents.id]
	}),
	itemInstance: one(itemInstances, {
		fields: [procurementSubmissions.itemInstanceId],
		references: [itemInstances.id]
	}),
	ledgerTransaction: one(ledgerTransactions, {
		fields: [procurementSubmissions.ledgerTransactionId],
		references: [ledgerTransactions.id]
	}),
	procurementOrder: one(procurementOrders, {
		fields: [procurementSubmissions.orderId],
		references: [procurementOrders.id]
	}),
}));

export const civicAnchorsRelations = relations(civicAnchors, ({one}) => ({
	city: one(cities, {
		fields: [civicAnchors.cityId],
		references: [cities.id]
	}),
	roadNode: one(roadNodes, {
		fields: [civicAnchors.roadNodeId],
		references: [roadNodes.id]
	}),
}));

export const deletionRequestsRelations = relations(deletionRequests, ({one}) => ({
	user: one(users, {
		fields: [deletionRequests.userId],
		references: [users.id]
	}),
}));

export const worldTemplateImportsRelations = relations(worldTemplateImports, ({one}) => ({
	city: one(cities, {
		fields: [worldTemplateImports.cityId],
		references: [cities.id]
	}),
}));

export const blocksRelations = relations(blocks, ({one}) => ({
	resident_blockedResidentId: one(residents, {
		fields: [blocks.blockedResidentId],
		references: [residents.id],
		relationName: "blocks_blockedResidentId_residents_id"
	}),
	resident_blockerResidentId: one(residents, {
		fields: [blocks.blockerResidentId],
		references: [residents.id],
		relationName: "blocks_blockerResidentId_residents_id"
	}),
}));

export const materialBalancesRelations = relations(materialBalances, ({one}) => ({
	resident: one(residents, {
		fields: [materialBalances.residentId],
		references: [residents.id]
	}),
}));

export const propertyVisitDailyRelations = relations(propertyVisitDaily, ({one}) => ({
	property: one(properties, {
		fields: [propertyVisitDaily.propertyId],
		references: [properties.id]
	}),
}));

export const cityActivationBundlesRelations = relations(cityActivationBundles, ({one}) => ({
	city: one(cities, {
		fields: [cityActivationBundles.cityId],
		references: [cities.id]
	}),
}));

export const idempotencyKeysRelations = relations(idempotencyKeys, ({one}) => ({
	user: one(users, {
		fields: [idempotencyKeys.userId],
		references: [users.id]
	}),
}));