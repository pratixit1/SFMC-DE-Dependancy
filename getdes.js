<script runat="server">
Platform.Load("Core", "1.1.1");

var prox = new Script.Util.WSProxy();
var targetDE = DataExtension.Init("653CA809-C8AE-499A-AFA3-E770E9E271F0");  
var cols = [
    "Name",
    "CustomerKey",
    "CategoryID",
    "CreatedDate",
    "ModifiedDate",
    "IsSendable",
    "IsTestable",
    "Description"
];

var moreData = true;
var reqID = null;
var allDEs = [];

while (moreData) {
    var result = reqID == null
        ? prox.retrieve("DataExtension", cols)
        : prox.getNextBatch("DataExtension", reqID);

    if (result && result.Results) {
        for (var i = 0; i < result.Results.length; i++) {
            allDEs.push(result.Results[i]);
        }
    }

    moreData = result.HasMoreRows;
    reqID = result.RequestID;
}


for (var j = 0; j < allDEs.length; j++) {
  if(allDEs[j].Name.indexOf("QueryStudio")>-1)
  {
    continue;
  }
   targetDE.Rows.Add({
    "DE Name": allDEs[j].Name
});
}
</script>
