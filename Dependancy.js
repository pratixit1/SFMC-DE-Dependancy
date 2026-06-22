<script runat="server">

/*
    Load the SFMC Core library so we can use built-in functions
    like DataExtension and WSProxy.
*/
Platform.Load("Core","1");

/*
    Create a WSProxy object.
    WSProxy is used to fetch Salesforce Marketing Cloud objects
    like Query Activities more efficiently.
*/
var prox = new Script.Util.WSProxy();

/*
    SOURCE_DE = External Key / CustomerKey of the source Data Extension
    This DE contains the list of Data Extension names that we want to check.

    RESULT_DE = External Key / CustomerKey of the result Data Extension
    This DE will store the final dependency results.

    BATCH_SIZE = Number of records to hold temporarily before inserting
    them into the result DE.
*/
var SOURCE_DE = "653CA809-C8AE-499A-AFA3-E770E9E271F0";
var RESULT_DE = "62560741-92F1-40E2-BEAB-1980D564F258";
var BATCH_SIZE = 100;


/********************************************************/
/* LOAD DE LIST */
/********************************************************/

/*
    deLookup will act like a quick reference list (dictionary/object).
    It stores all DE names from the source DE in lowercase as keys,
    so matching becomes easier and case-insensitive.
*/
var deLookup = {};

/*
    Initialize the source Data Extension.
*/
var sourceDE = DataExtension.Init(SOURCE_DE);

/*
    Get all rows from the source DE.
    Each row is expected to contain a field called "DE Name".
*/
var deRows = sourceDE.Rows.Retrieve();

/*
    Loop through all rows from the source DE
    and store each DE name in deLookup.
*/
for(var i=0; i<deRows.length; i++){

    var deName = String(deRows[i]["DE Name"]);

    /*
        Store DE names in lowercase for easy matching,
        but keep original value as the actual name.
    */
    deLookup[deName.toLowerCase()] = deName;
}


/********************************************************/
/* RESULT DE */
/********************************************************/

/*
    Initialize the result DE where all dependency findings
    will be stored.
*/
var resultDE = DataExtension.Init(RESULT_DE);


/********************************************************/
/* BUFFER */
/********************************************************/

/*
    buffer = temporary storage for rows before inserting into result DE.
    duplicateCheck = used to avoid inserting duplicate dependency records.
*/
var buffer = [];
var duplicateCheck = {};

/*
    This function inserts all buffered rows into the result DE
    and then clears the buffer.
*/
function flushBuffer(){

    for(var i=0; i<buffer.length; i++){
        resultDE.Rows.Add(buffer[i]);
    }

    buffer = [];
}


/********************************************************/
/* QUERY ACTIVITIES */
/********************************************************/

/*
    These are the fields we want to fetch from each Query Activity:
    - Name = Query Activity name
    - QueryText = SQL inside the query activity
    - DataExtensionTarget.Name = Target DE name of the query
*/
var cols = [
    "Name",
    "QueryText",
    "DataExtensionTarget.Name"
];

/*
    moreData tells us if more query activity records are available.
    reqID is used by WSProxy for pagination (fetching next batch).
*/
var moreData = true;
var reqID = null;

/*
    Loop through all Query Activities in batches.
*/
while(moreData){

    var qr;

    /*
        First time: retrieve initial batch
        Next times: retrieve next batch using RequestID
    */
    if(reqID == null){
        qr = prox.retrieve("QueryDefinition", cols);
    }else{
        qr = prox.getNextBatch("QueryDefinition", reqID);
    }

    /*
        If records are returned, process them one by one.
    */
    if(qr && qr.Results){

        for(var q=0; q<qr.Results.length; q++){

            /*
                Get the Query Activity name.
            */
            var queryName = qr.Results[q].Name;

            /*
                Get the SQL text used inside the Query Activity.
                If blank, use empty string.
            */
            var sql = qr.Results[q].QueryText || "";

            /*
                Lowercase version of SQL (currently not used further,
                but could be useful for matching).
            */
            var sqlLower = sql.toLowerCase();

            /********************************************/
            /* TARGET CHECK */
            /********************************************/

            /*
                Here we check if the target DE of the query activity
                is one of the DEs from our source list.
            */
            try{

                var targetDE = qr.Results[q].DataExtensionTarget.Name;

                if(targetDE){

                    var targetKey = targetDE.toLowerCase();

                    /*
                        If target DE is present in our lookup list,
                        record it as TARGET usage.
                    */
                    if(deLookup[targetKey]){

                        /*
                            Create a unique key to prevent duplicates.
                        */
                        var uniqueKey = targetDE + "|" + queryName + "|TARGET";

                        if(!duplicateCheck[uniqueKey]){

                            duplicateCheck[uniqueKey] = true;

                            /*
                                Add result to buffer.
                            */
                            buffer.push({
                                DataExtensionName : targetDE,
                                QueryActivity : queryName,
                                UsageType : "TARGET"
                            });
                        }
                    }
                }

            /*
                If target DE info is missing or causes an error,
                skip it silently.
            */
            }catch(e){}

            /********************************************/
            /* FROM / JOIN CHECK */
            /********************************************/

            /*
                Now check whether any DE from the source list
                is being referenced in the SQL using FROM or JOIN.
            */
            for(var key in deLookup){

                var deName = deLookup[key];

                /*
                    Escape special regex characters in DE name
                    so the name can safely be used in regex matching.
                */
                var escapedName = deName.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    "\\$&"
                );

                /*
                    Regex to check if DE name is used after FROM.
                    Example: FROM MyDataExtension
                */
                var fromRegex = new RegExp(
                    "\\bfrom\\b[\\s\\[]*.*?" + escapedName,
                    "i"
                );

                /*
                    Regex to check if DE name is used after JOIN.
                    Example: JOIN MyDataExtension
                */
                var joinRegex = new RegExp(
                    "\\bjoin\\b[\\s\\[]*.*?" + escapedName,
                    "i"
                );

                /*
                    If matched in FROM clause, store as FROM usage.
                */
                if(fromRegex.test(sql)){

                    var fromUnique = deName + "|" + queryName + "|FROM";

                    if(!duplicateCheck[fromUnique]){

                        duplicateCheck[fromUnique] = true;

                        buffer.push({
                            DataExtensionName : deName,
                            QueryActivity : queryName,
                            UsageType : "FROM"
                        });
                    }
                }

                /*
                    If matched in JOIN clause, store as JOIN usage.
                */
                if(joinRegex.test(sql)){

                    var joinUnique = deName + "|" + queryName + "|JOIN";

                    if(!duplicateCheck[joinUnique]){

                        duplicateCheck[joinUnique] = true;

                        buffer.push({
                            DataExtensionName : deName,
                            QueryActivity : queryName,
                            UsageType : "JOIN"
                        });
                    }
                }

                /*
                    If buffer has reached the batch size,
                    write data into result DE immediately.
                */
                if(buffer.length >= BATCH_SIZE){
                    flushBuffer();
                }
            }
        }
    }

    /*
        Check if more Query Activity records are available.
    */
    moreData = qr && qr.HasMoreRows;

    /*
        Save RequestID for the next batch.
    */
    reqID = qr ? qr.RequestID : null;
}


/********************************************************/
/* FINAL FLUSH */
/********************************************************/

/*
    Insert any remaining buffered records into result DE.
*/
flushBuffer();

/*
    Print success message on the page.
*/
Write("Dependency scan completed successfully.");

</script>
